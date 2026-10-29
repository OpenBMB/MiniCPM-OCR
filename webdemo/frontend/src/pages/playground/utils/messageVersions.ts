/**
 * Playground 多版本回答与反馈态纯函数。
 *
 * 用途：维护「顶层字段镜像 versions[activeVersion]」不变式；regenerate 准备态、反馈切换、版本翻页。
 */

import type { ChatMessage, MessageFeedback } from '../types';
import { applyVersion, snapshotVersion } from './messages';

/** regenerate 所需的上下文：assistant 之前的可发送历史 + 目标消息 */
export interface RegenerateContext {
  base: ChatMessage[];
  target: ChatMessage;
}

/**
 * 解析重新生成上下文：目标 assistant 之前的消息须含至少一条可发送 user 轮次。
 * @param messages 当前消息列表
 * @param assistantId 目标 assistant id
 * @returns 上下文或 null（找不到 / 不可发送时）
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
 * 构造重新生成前的 assistant 消息：保留 versions，清空 live 字段，标 streaming。
 * @param target 当前 assistant 消息
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
 * 在列表中替换目标 assistant 为重新生成准备态。
 * @param list 当前消息列表
 * @param assistantId 目标 id
 * @param prepared prepareRegenerateMessage 的结果
 */
export function applyRegeneratePrep(
  list: ChatMessage[],
  assistantId: string,
  prepared: ChatMessage,
): ChatMessage[] {
  return list.map((m) => (m.id === assistantId ? prepared : m));
}

/**
 * 切换单条消息的反馈态（赞/踩互斥，再次点击同项取消），并同步进当前选中版本。
 * @param message 目标 assistant 消息
 * @param kind 赞或踩
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
 * 在列表中切换指定 assistant 的反馈态。
 * @param list 当前消息列表
 * @param assistantId 目标 id
 * @param kind 赞或踩
 */
export function applyFeedbackToggle(
  list: ChatMessage[],
  assistantId: string,
  kind: MessageFeedback,
): ChatMessage[] {
  return list.map((m) => (m.id === assistantId ? toggleFeedbackOnMessage(m, kind) : m));
}

/**
 * 在列表中把指定 assistant 切换到某个显示版本（‹n/N› 翻页）。
 * @param list 当前消息列表
 * @param assistantId 目标 id
 * @param index 版本索引
 */
export function applyActiveVersionSwitch(
  list: ChatMessage[],
  assistantId: string,
  index: number,
): ChatMessage[] {
  return list.map((m) => (m.id === assistantId ? applyVersion(m, index) : m));
}
