/**
 * Playground 一次补全生命周期的纯函数。
 *
 * 用途：auth 校验、流式收尾、abort/fail 时的消息列表变换；供 useChatCompletion 与单测复用。
 * 流式 SSE 回调集合在 chatStreamCallbacks.ts。
 */

import type { ChatMessage } from '../types';
import { appendToMessage, applyVersion, snapshotVersion } from './messages';
import { normalizeAssistantReply } from './thinkSplit';
import { finalizeToolEvents } from './toolEvents';

/** 未选 Key / 密钥未就绪时的统一错误文案 */
export const COMPLETION_KEY_ERROR = '请先在左下角选择一个 API Key 以建立会话';

/**
 * 校验补全前 auth 条件；返回错误文案或 null（可继续发起请求）。
 * @param webSearch 是否联网模式
 * @param keyId 联网模式使用的 API Key ID
 * @param secret 普通模式使用的明文密钥
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
 * 正常完成：落定 streaming 字段、写入总耗时，并把当前回答快照进 versions[]。
 * @param list 当前消息列表
 * @param assistantId 目标 assistant 消息 id
 * @param startedAt performance.now() 起点
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
 * 用户主动停止：首次生成保留 partial 正文但不写入 versions；重新生成回退到末个已完成版本。
 * @param list 当前消息列表
 * @param assistantId 目标 assistant 消息 id
 * @param startedAt performance.now() 起点
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
 * 请求失败：有历史版本则回退；首次生成则在顶层标 error。
 * @param list 当前消息列表
 * @param assistantId 目标 assistant 消息 id
 * @param message 用户可见错误文案
 * @param errorCode 上游错误码
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
      // 输出安审撤回：正文与思考都可能已经上屏，必须一并清空后替换为中性提示，
      // 否则被撤回的内容会残留在气泡、会话历史与下一轮 messages 里。
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

/** 将当前 assistant 占位及其对应的最近用户消息标记为不可进入后续模型上下文。 */
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
