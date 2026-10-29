/**
 * Experience-center context budget.
 *
 * Purpose: from the context window declared in the model catalog, reserve room for output and a safety margin; the frontend only makes a conservative estimate and
 * trims history. It does not take part in usage calculation or billing. Real token usage still comes from the usage returned by LIS.
 */

import type { ChatRequestMessage } from '@/api/map/chat';
import type { AttachmentKind, ChatMessage } from '../types';
import { attachmentToPart } from './attachments';
import { normalizeAssistantReply } from './thinkSplit';

const DEFAULT_OUTPUT_RESERVE_TOKENS = 1024;
const MESSAGE_OVERHEAD_TOKENS = 4;
const ATTACHMENT_TOKEN_ESTIMATES: Record<AttachmentKind, number> = {
  image: 2048,
  video: 4096,
  audio: 1024,
  file: 1024,
};

/**
 * Context-window management is implemented, and is currently left off for users by product policy.
 * Once enabled it shows an occupancy hint and trims history by complete question-answer turns before send.
 */
export const CONTEXT_WINDOW_MANAGEMENT_ENABLED = false;

export interface ContextWindowOptions {
  /** context_window from the model catalog; 0 means no declared limit. */
  contextWindow: number;
  /** max_output_tokens from the model catalog. */
  modelMaxOutputTokens: number;
  /** max_tokens set in the parameter panel; used first when greater than 0. */
  requestedMaxOutputTokens?: number;
  /** Optional system prompt, always kept at the start of the request. */
  systemPrompt?: string;
}

export interface ContextWindowPlan {
  requestMessages: ChatRequestMessage[];
  /** Conservative estimate for text and attachments, not the model's real tokenizer count. */
  estimatedInputTokens: number;
  /** null when no window is declared, meaning the frontend does not trim. */
  inputBudgetTokens: number | null;
  reservedOutputTokens: number;
  safetyMarginTokens: number;
  trimmedMessageCount: number;
  /** The system prompt and the latest turn alone already exceed the input budget, so the request cannot be sent safely. */
  isOverBudget: boolean;
}

/**
 * Build a request plan that fits the context window.
 *
 * Trimming happens only after the last manual clear-context divider; the system prompt, the current question, and
 * the most recent complete question-answer turns are kept first. If the current question itself exceeds the budget, return isOverBudget so the caller can block the request.
 */
export function buildContextWindowPlan(
  list: ChatMessage[],
  options: ContextWindowOptions,
): ContextWindowPlan {
  const systemPrompt = options.systemPrompt?.trim();
  const systemMessage = systemPrompt
    ? ({ role: 'system', content: systemPrompt } satisfies ChatRequestMessage)
    : undefined;
  const effectiveMessages = getEffectiveMessages(list);
  const units = groupConversationTurns(effectiveMessages);
  const contextWindow = Math.max(0, Math.floor(options.contextWindow));

  if (contextWindow === 0) {
    const requestMessages = [
      ...(systemMessage ? [systemMessage] : []),
      ...effectiveMessages.map(toRequestMessage),
    ];
    return {
      requestMessages,
      estimatedInputTokens: estimateRequestTokens(requestMessages),
      inputBudgetTokens: null,
      reservedOutputTokens: 0,
      safetyMarginTokens: 0,
      trimmedMessageCount: 0,
      isOverBudget: false,
    };
  }

  let outputReserve = DEFAULT_OUTPUT_RESERVE_TOKENS;
  if (options.requestedMaxOutputTokens && options.requestedMaxOutputTokens > 0) {
    outputReserve = options.requestedMaxOutputTokens;
  } else if (options.modelMaxOutputTokens > 0) {
    outputReserve = options.modelMaxOutputTokens;
  }
  const reservedOutputTokens = Math.min(contextWindow, Math.max(0, Math.floor(outputReserve)));
  const safetyMarginTokens = Math.min(1024, Math.max(128, Math.ceil(contextWindow * 0.02)));
  const inputBudgetTokens = Math.max(0, contextWindow - reservedOutputTokens - safetyMarginTokens);
  const baseTokens = systemMessage ? estimateRequestMessageTokens(systemMessage) : 0;
  const kept: ChatMessage[][] = [];
  let usedTokens = baseTokens;
  let lastExcludedUnit = -1;

  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index];
    const unitTokens = estimateChatMessagesTokens(unit);
    if (usedTokens + unitTokens > inputBudgetTokens) {
      lastExcludedUnit = index;
      break;
    }
    kept.unshift(unit);
    usedTokens += unitTokens;
  }

  const latestUnit = units.length > 0 ? units[units.length - 1] : [];
  const mandatoryTokens = baseTokens + estimateChatMessagesTokens(latestUnit);
  const isOverBudget = mandatoryTokens > inputBudgetTokens;
  const keptMessages = isOverBudget ? latestUnit : kept.flat();
  let trimmedMessageCount = 0;
  if (isOverBudget) {
    trimmedMessageCount = Math.max(0, effectiveMessages.length - latestUnit.length);
  } else if (lastExcludedUnit >= 0) {
    trimmedMessageCount = units.slice(0, lastExcludedUnit + 1).flat().length;
  }
  const requestMessages = [
    ...(systemMessage ? [systemMessage] : []),
    ...keptMessages.map(toRequestMessage),
  ];

  return {
    requestMessages,
    estimatedInputTokens: estimateRequestTokens(requestMessages),
    inputBudgetTokens,
    reservedOutputTokens,
    safetyMarginTokens,
    trimmedMessageCount,
    isOverBudget,
  };
}

/** Estimate text tokens; Chinese and other non-ASCII characters use a more conservative one-token-per-character estimate. */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  let asciiCharacters = 0;
  let nonAsciiCharacters = 0;
  for (const character of text) {
    if (character.charCodeAt(0) <= 0x7f) asciiCharacters += 1;
    else nonAsciiCharacters += 1;
  }
  return Math.ceil(asciiCharacters / 4) + nonAsciiCharacters;
}

function getEffectiveMessages(list: ChatMessage[]): ChatMessage[] {
  let lastDivider = -1;
  for (let index = 0; index < list.length; index += 1) {
    if (list[index]?.divider) lastDivider = index;
  }
  return (lastDivider >= 0 ? list.slice(lastDivider + 1) : list)
    .filter(
      (message) =>
        !message.divider &&
        !message.contextExcluded &&
        message.role !== 'system' &&
        !message.interrupted &&
        Boolean(message.content || message.reasoning || message.attachments?.length),
    )
    .map((message) => normalizeAssistantForRequest(message))
    .filter(
      (message) =>
        message.role !== 'assistant' ||
        Boolean(message.content.trim() || message.attachments?.length),
    );
}

function groupConversationTurns(messages: ChatMessage[]): ChatMessage[][] {
  const units: ChatMessage[][] = [];
  let current: ChatMessage[] | undefined;
  for (const message of messages) {
    if (message.role === 'user') {
      current = [message];
      units.push(current);
      continue;
    }
    if (current) current.push(message);
    else units.push([message]);
  }
  return units;
}

function toRequestMessage(message: ChatMessage): ChatRequestMessage {
  if (message.role === 'user' && message.attachments?.length) {
    const content: ChatRequestMessage['content'] = [];
    if (message.content) content.push({ type: 'text', text: message.content });
    for (const attachment of message.attachments) content.push(attachmentToPart(attachment));
    return { role: message.role, content };
  }
  return { role: message.role, content: message.content };
}

function normalizeAssistantForRequest(message: ChatMessage): ChatMessage {
  if (message.role !== 'assistant') return message;
  const normalized = normalizeAssistantReply(message.content, message.reasoning);
  return { ...message, content: normalized.content, reasoning: undefined };
}

function estimateChatMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => total + estimateChatMessageTokens(message), 0);
}

function estimateChatMessageTokens(message: ChatMessage): number {
  return (
    MESSAGE_OVERHEAD_TOKENS +
    estimateTextTokens(message.content) +
    (message.attachments?.reduce(
      (total, attachment) => total + ATTACHMENT_TOKEN_ESTIMATES[attachment.kind],
      0,
    ) ?? 0)
  );
}

function estimateRequestTokens(messages: ChatRequestMessage[]): number {
  return messages.reduce((total, message) => total + estimateRequestMessageTokens(message), 0);
}

function estimateRequestMessageTokens(message: ChatRequestMessage): number {
  if (typeof message.content === 'string')
    return MESSAGE_OVERHEAD_TOKENS + estimateTextTokens(message.content);
  return (
    MESSAGE_OVERHEAD_TOKENS +
    message.content.reduce((total, part) => {
      if (part.type === 'text') return total + estimateTextTokens(part.text);
      if (part.type === 'image_url') return total + ATTACHMENT_TOKEN_ESTIMATES.image;
      if (part.type === 'video_url') return total + ATTACHMENT_TOKEN_ESTIMATES.video;
      if (part.type === 'input_audio') return total + ATTACHMENT_TOKEN_ESTIMATES.audio;
      return total + ATTACHMENT_TOKEN_ESTIMATES.file;
    }, 0)
  );
}
