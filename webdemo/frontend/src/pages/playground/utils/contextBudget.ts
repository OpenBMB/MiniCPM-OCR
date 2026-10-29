/**
 * 体验中心上下文预算。
 *
 * 用途：依据模型目录声明的上下文窗口，为输出和安全余量预留空间；前端仅做保守估算与
 * 历史裁剪，不参与用量计算或计费。真实 token 用量仍以 LIS 返回的 usage 为准。
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
 * 上下文窗口管理能力已实现，当前按产品策略暂不对用户启用。
 * 启用后会展示占用提示，并在发送前按完整问答轮次裁剪历史。
 */
export const CONTEXT_WINDOW_MANAGEMENT_ENABLED = false;

export interface ContextWindowOptions {
  /** 模型目录中的 context_window，0 表示未声明限制。 */
  contextWindow: number;
  /** 模型目录中的 max_output_tokens。 */
  modelMaxOutputTokens: number;
  /** 用户在参数面板设置的 max_tokens；大于 0 时优先使用。 */
  requestedMaxOutputTokens?: number;
  /** 可选系统提示，始终保留在请求开头。 */
  systemPrompt?: string;
}

export interface ContextWindowPlan {
  requestMessages: ChatRequestMessage[];
  /** 文本与附件的保守估算值，不是模型 tokenizer 的真值。 */
  estimatedInputTokens: number;
  /** 未声明窗口时为 null，代表不做前端裁剪。 */
  inputBudgetTokens: number | null;
  reservedOutputTokens: number;
  safetyMarginTokens: number;
  trimmedMessageCount: number;
  /** 系统提示和最近一轮本身已超过输入预算，不能安全发送。 */
  isOverBudget: boolean;
}

/**
 * 将消息构造成满足上下文窗口的请求计划。
 *
 * 裁剪只发生在最后一条手动清除上下文的分隔线之后；优先保留系统提示、当前提问和
 * 最近完整问答轮次。若当前提问本身超出预算，返回 isOverBudget 供调用方阻止请求。
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

/** 估算文本 token；中文及其他非 ASCII 字符按更保守的单字一 token 估算。 */
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
