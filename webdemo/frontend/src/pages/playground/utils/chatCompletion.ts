/**
 * Pure functions for one Playground completion lifecycle.
 *
 * Purpose: auth checks, streaming finalization, and message-list transforms on abort/fail; shared by useChatCompletion and unit tests.
 * The streaming SSE callback set lives in chatStreamCallbacks.ts.
 */

import type { ChatMessage } from '../types';
import { appendToMessage, applyVersion, snapshotVersion } from './messages';
import { normalizeAssistantReply } from './thinkSplit';
import { finalizeToolEvents } from './toolEvents';

/** Shared error copy when no key is selected or the secret is not ready */
export const COMPLETION_KEY_ERROR = '请先在左下角选择一个 API Key 以建立会话';

/**
 * Check auth conditions before a completion; return error copy or null (the request may proceed).
 * @param webSearch whether web-search mode is on
 * @param keyId API Key ID used in web-search mode
 * @param secret plaintext secret used in normal mode
 */
export function authErrorForCompletion(
  webSearch: boolean,
  keyId?: string,
  secret?: string,
): string | null {
  if (webSearch && !keyId) return COMPLETION_KEY_ERROR;
  if (!webSearch && !secret) return COMPLETION_KEY_ERROR;
  return null;
}

/**
 * Normal completion: settle streaming fields, record total elapsed time, and snapshot the current answer into versions[].
 * @param list current message list
 * @param assistantId target assistant message id
 * @param startedAt performance.now() start
 */
export function finalizeCompletedMessages(
  list: ChatMessage[],
  assistantId: string,
  startedAt: number,
): ChatMessage[] {
  const finalized = appendToMessage(list, assistantId, {
    streaming: false,
    searching: false,
    metrics: { durationMs: Math.round(performance.now() - startedAt) },
  });
  return finalized.map((m) => {
    if (m.id !== assistantId) return m;
    const normalized = normalizeAssistantReply(m.content, m.reasoning);
    const cleaned: ChatMessage = {
      ...m,
      content: normalized.content,
      reasoning: normalized.reasoning || undefined,
      interrupted: undefined,
    };
    const versions = [...(cleaned.versions ?? []), snapshotVersion(cleaned)];
    return { ...cleaned, versions, activeVersion: versions.length - 1 };
  });
}

/**
 * User stop: the first generation keeps the partial body but does not write versions; a regeneration rolls back to the last completed version.
 * @param list current message list
 * @param assistantId target assistant message id
 * @param startedAt performance.now() start
 */
export function finalizeAbortedMessages(
  list: ChatMessage[],
  assistantId: string,
  startedAt: number,
): ChatMessage[] {
  return list.map((m) => {
    if (m.id !== assistantId) return m;
    const durationMs = Math.round(performance.now() - startedAt);
    if (m.versions && m.versions.length > 0) {
      return applyVersion(
        {
          ...m,
          streaming: false,
          searching: false,
          toolEvents: finalizeToolEvents(m.toolEvents ?? [], 'interrupted'),
          metrics: { ...m.metrics, durationMs },
        },
        m.versions.length - 1,
      );
    }
    return {
      ...m,
      streaming: false,
      searching: false,
      toolEvents: finalizeToolEvents(m.toolEvents ?? [], 'interrupted'),
      metrics: { ...m.metrics, durationMs },
    };
  });
}

/**
 * Request failure: roll back when history versions exist; on the first generation, mark error on the top-level message.
 * @param list current message list
 * @param assistantId target assistant message id
 * @param message user-visible error copy
 * @param errorCode upstream error code
 */
export function finalizeFailedMessages(
  list: ChatMessage[],
  assistantId: string,
  failureMessage: string,
  errorCode?: string,
): ChatMessage[] {
  if (errorCode === 'content_policy_violation') {
    return markConversationTurnContextExcluded(list, assistantId).map((item) => {
      if (item.id !== assistantId) return item;
      // Output safety recall: body and reasoning may already be on screen, so both must be cleared and replaced with a neutral notice,
      // otherwise the recalled content would remain in the bubble, conversation history, and the next turn's messages.
      return {
        ...item,
        content: failureMessage,
        reasoning: undefined,
        searchActiveTool: undefined,
        searchBrowseCount: undefined,
        searchQueries: undefined,
        searchTools: undefined,
        toolEvents: undefined,
        citations: undefined,
        streaming: false,
        searching: false,
        searchStatus: '',
        contextExcluded: true,
        errorCode,
      };
    });
  }

  return list.map((m) => {
    if (m.id !== assistantId) return m;
    if (m.versions && m.versions.length > 0) {
      return applyVersion({ ...m, streaming: false, searching: false }, m.versions.length - 1);
    }
    return {
      ...m,
      streaming: false,
      searching: false,
      toolEvents: finalizeToolEvents(m.toolEvents ?? [], 'failed'),
      error: failureMessage,
      ...(errorCode ? { errorCode } : {}),
    };
  });
}

/** Mark the current assistant placeholder and its nearest user message as excluded from later model context. */
export function markConversationTurnContextExcluded(
  list: ChatMessage[],
  assistantId: string,
): ChatMessage[] {
  const assistantIndex = list.findIndex((message) => message.id === assistantId);
  if (assistantIndex < 0) return list;
  let userIndex = -1;
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (list[index]?.divider) break;
    if (list[index]?.role !== 'user') continue;
    userIndex = index;
    break;
  }
  return list.map((item, index) =>
    index === userIndex || item.id === assistantId ? { ...item, contextExcluded: true } : item,
  );
}
