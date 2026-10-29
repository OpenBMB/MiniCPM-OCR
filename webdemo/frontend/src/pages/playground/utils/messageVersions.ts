/**
 * Pure functions for Playground multi-version answers and feedback state.
 *
 * Purpose: keep the invariant "top-level fields mirror versions[activeVersion]"; regenerate preparing state, feedback toggle, and version paging.
 */

import type { ChatMessage, MessageFeedback } from '../types';
import { applyVersion, snapshotVersion } from './messages';

/** Context regenerate needs: sendable history before the assistant, plus the target message */
export interface RegenerateContext {
  base: ChatMessage[];
  target: ChatMessage;
}

/**
 * Resolve regenerate context: messages before the target assistant must include at least one sendable user turn.
 * @param messages current message list
 * @param assistantId target assistant id
 * @returns the context, or null (not found / not sendable)
 */
export function findRegenerateContext(
  messages: ChatMessage[],
  assistantId: string,
): RegenerateContext | null {
  const ai = messages.findIndex((m) => m.id === assistantId);
  if (ai < 0) return null;
  const base = messages.slice(0, ai);
  if (!base.some((m) => m.role === 'user' && (m.content || m.attachments?.length))) return null;
  return { base, target: messages[ai] };
}

/**
 * Build the assistant message before regenerate: keep versions, clear live fields, and mark streaming.
 * @param target current assistant message
 */
export function prepareRegenerateMessage(target: ChatMessage): ChatMessage {
  const existingVersions = (
    target.versions ?? (target.interrupted ? [] : [snapshotVersion(target)])
  ).filter((version) => !version.interrupted);
  return {
    ...target,
    content: '',
    reasoning: undefined,
    searchStatus: undefined,
    searchStep: undefined,
    searchResultCount: undefined,
    searchActiveTool: undefined,
    searchBrowseCount: undefined,
    searchQueries: undefined,
    searchTools: undefined,
    toolEvents: undefined,
    citations: undefined,
    usage: undefined,
    metrics: undefined,
    requestId: undefined,
    clientRequestId: undefined,
    apiKeyId: undefined,
    error: undefined,
    interrupted: undefined,
    feedback: undefined,
    versions: existingVersions,
    streaming: true,
    searching: false,
  };
}

/**
 * Replace the target assistant in the list with the regenerate preparing state.
 * @param list current message list
 * @param assistantId target id
 * @param prepared result of prepareRegenerateMessage
 */
export function applyRegeneratePrep(
  list: ChatMessage[],
  assistantId: string,
  prepared: ChatMessage,
): ChatMessage[] {
  return list.map((m) => (m.id === assistantId ? prepared : m));
}

/**
 * Toggle feedback on a single message (like/dislike are exclusive; clicking the same one again clears it), and sync it into the currently selected version.
 * @param message target assistant message
 * @param kind like or dislike
 */
export function toggleFeedbackOnMessage(message: ChatMessage, kind: MessageFeedback): ChatMessage {
  const next = message.feedback === kind ? undefined : kind;
  let versions = message.versions;
  if (versions && message.activeVersion !== undefined && versions[message.activeVersion]) {
    versions = versions.map((v, i) => (i === message.activeVersion ? { ...v, feedback: next } : v));
  }
  return { ...message, feedback: next, versions };
}

/**
 * Toggle feedback for a given assistant in the list.
 * @param list current message list
 * @param assistantId target id
 * @param kind like or dislike
 */
export function applyFeedbackToggle(
  list: ChatMessage[],
  assistantId: string,
  kind: MessageFeedback,
): ChatMessage[] {
  return list.map((m) => (m.id === assistantId ? toggleFeedbackOnMessage(m, kind) : m));
}

/**
 * Switch a given assistant in the list to a display version (‹n/N› paging).
 * @param list current message list
 * @param assistantId target id
 * @param index version index
 */
export function applyActiveVersionSwitch(
  list: ChatMessage[],
  assistantId: string,
  index: number,
): ChatMessage[] {
  return list.map((m) => (m.id === assistantId ? applyVersion(m, index) : m));
}
