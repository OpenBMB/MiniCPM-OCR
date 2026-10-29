/**
 * 对话消息构造与增量合并纯函数。
 *
 * 用途：把 useChat 的消息状态变换收敛为无副作用纯函数，便于复用与单测。
 */

import type { AnswerVersion, ChatMessage, ChatRole, Citation } from '../types';
import type { ChatRequestMessage } from '@/api/map/chat';
import { attachmentToPart } from './attachments';
import { citationURLKey } from './citations';
import { buildContextWindowPlan, type ContextWindowOptions } from './contextBudget';
import { normalizeAssistantReply } from './thinkSplit';

/**
 * 上下文分隔线的存储标记。
 * 分隔线在前端以 `divider:true` 标识；持久化时无独立字段，借用 role='system' + 本标记往返，
 * 加载时据此还原 divider 标记（见 conversations.ts）。
 */
export const CONTEXT_DIVIDER_MARKER = '[[map:context-cleared]]';

/** 生成一个轻量唯一 id（无需 crypto，足够前端去重/key 使用） */
export function genId(seed: number): string {
  return `m_${seed.toString(36)}_${(seed % 1000).toString(36)}`;
}

/** 构造一条上下文分隔线消息（role=system 以便默认不参与请求，content 用标记以便持久化往返） */
export function makeDivider(id: string): ChatMessage {
  return { id, role: 'system', content: CONTEXT_DIVIDER_MARKER, divider: true };
}

/**
 * 构造一条消息。
 * @param id 唯一 id
 * @param role 角色
 * @param content 正文
 * @param extra 额外字段（streaming/reasoning 等）
 */
export function makeMessage(
  id: string,
  role: ChatRole,
  content: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return { id, role, content, ...extra };
}

/**
 * 把流式增量并入消息列表中指定 id 的消息（函数式更新，不可变）。
 *
 * @param list 当前消息列表
 * @param id 目标 assistant 消息 id
 * @param patch 要合并/追加的内容（content/reasoning 为追加，其余字段为覆盖）
 */
export function appendToMessage(
  list: ChatMessage[],
  id: string,
  patch: Partial<ChatMessage> & {
    contentDelta?: string;
    reasoningDelta?: string;
    citationsDelta?: Citation[];
    searchQueriesDelta?: string[];
    searchToolsDelta?: string[];
    toolEvents?: ChatMessage['toolEvents'];
  },
): ChatMessage[] {
  return list.map((m) => {
    if (m.id !== id) return m;
    const next: ChatMessage = { ...m };
    if (patch.contentDelta) next.content = m.content + patch.contentDelta;
    if (patch.reasoningDelta) next.reasoning = (m.reasoning ?? '') + patch.reasoningDelta;
    // 引用来源按 url 去重合并（流式下可能多帧携带同一来源）
    if (patch.citationsDelta && patch.citationsDelta.length) {
      next.citations = mergeCitations(m.citations, patch.citationsDelta);
    }
    if (patch.streaming !== undefined) next.streaming = patch.streaming;
    if (patch.searching !== undefined) next.searching = patch.searching;
    if (patch.searchStatus !== undefined) next.searchStatus = patch.searchStatus;
    if (patch.searchStep !== undefined) next.searchStep = patch.searchStep;
    if (patch.searchResultCount !== undefined) next.searchResultCount = patch.searchResultCount;
    if (patch.searchActiveTool !== undefined) next.searchActiveTool = patch.searchActiveTool;
    if (patch.searchBrowseCount !== undefined) next.searchBrowseCount = patch.searchBrowseCount;
    if (patch.searchQueries !== undefined) next.searchQueries = patch.searchQueries;
    if (patch.searchQueriesDelta?.length) {
      next.searchQueries = mergeUniqueStrings(m.searchQueries, patch.searchQueriesDelta);
    }
    if (patch.searchTools !== undefined) next.searchTools = patch.searchTools;
    if (patch.searchToolsDelta?.length) {
      next.searchTools = mergeUniqueStrings(m.searchTools, patch.searchToolsDelta);
    }
    if (patch.toolEvents !== undefined) next.toolEvents = patch.toolEvents;
    if (patch.usage !== undefined) next.usage = patch.usage;
    if (patch.requestId !== undefined) next.requestId = patch.requestId;
    if (patch.clientRequestId !== undefined) next.clientRequestId = patch.clientRequestId;
    if (patch.apiKeyId !== undefined) next.apiKeyId = patch.apiKeyId;
    // metrics 为增量合并：保留已有字段，仅覆盖本次提供的（首 token 与总耗时分两次到达）
    if (patch.metrics !== undefined) next.metrics = { ...m.metrics, ...patch.metrics };
    if (patch.error !== undefined) next.error = patch.error;
    return next;
  });
}

/**
 * 合并引用来源并去重；保持首次顺序，同时保留后续工具返回的更完整元数据。
 *
 * 身份优先取后端编号 ref：它跨轮跨工具与 URL 一一绑定，比任何前端归一化都准。
 * 没有 ref（老后端）时退回 citationURLKey——此前这里用的是裸 url，与别处（角标匹配、
 * 来源面板高亮）用的归一化键不是一套口径，差一个末尾斜杠就会多出一条重复来源。
 *
 * @param prev 已累积的来源
 * @param incoming 本次事件带来的来源
 * @returns 合并后的来源列表；全部带 ref 时按 ref 升序，保证列表序号连续
 */
export function mergeCitations(prev: Citation[] | undefined, incoming: Citation[]): Citation[] {
  const merged = [...(prev ?? [])];
  const indexByIdentity = new Map(
    merged.map((citation, index) => [citationIdentity(citation), index]),
  );
  for (const c of incoming) {
    const existingIndex = indexByIdentity.get(citationIdentity(c));
    if (existingIndex !== undefined) {
      const existing = merged[existingIndex];
      merged[existingIndex] = {
        ...existing,
        // ref 回填：同一来源可能先由不带编号的通道到达，后续事件补上编号。
        ...(!existing.ref && c.ref ? { ref: c.ref } : {}),
        ...(!existing.title && c.title ? { title: c.title } : {}),
        ...(preferLongerText(existing.snippet, c.snippet) ? { snippet: c.snippet } : {}),
      };
      continue;
    }
    indexByIdentity.set(citationIdentity(c), merged.length);
    merged.push(c);
  }
  // 全部带编号时按编号排序：来源面板展示的就是 ref，数组顺序与编号不一致会让列表读成 1,2,5,3。
  // 只差一条没编号就不排，避免把「无编号」的那条挤到一个它并不属于的位置。
  if (merged.length > 0 && merged.every((c) => Boolean(c.ref))) {
    merged.sort((a, b) => (a.ref ?? 0) - (b.ref ?? 0));
  }
  return merged;
}

/** 来源的去重身份：有后端编号用编号，否则用归一化 URL 键。 */
function citationIdentity(citation: Citation): string {
  return citation.ref ? `ref:${citation.ref}` : `url:${citationURLKey(citation.url)}`;
}

/** 后续网页读取正文比搜索摘要更完整时，用更长文本补全预览。 */
function preferLongerText(current?: string, incoming?: string): incoming is string {
  return Boolean(incoming && incoming.length > (current?.length ?? 0));
}

/**
 * 把本页消息历史转为后端请求所需的最小结构（仅 role + content，剔除空的流式占位）。
 *
 * @param list 本页消息列表
 * @param systemPrompt 可选系统提示，置于最前
 */
export function toRequestMessages(
  list: ChatMessage[],
  systemPrompt?: string,
  contextOptions?: Omit<ContextWindowOptions, 'systemPrompt'>,
): ChatRequestMessage[] {
  if (contextOptions) {
    return buildContextWindowPlan(list, { ...contextOptions, systemPrompt }).requestMessages;
  }
  const out: ChatRequestMessage[] = [];
  if (systemPrompt && systemPrompt.trim()) {
    out.push({ role: 'system', content: systemPrompt.trim() });
  }
  // 上下文截断：只取最后一条分隔线之后的消息（分隔线以上的历史不再作为上下文发送）
  let lastDivider = -1;
  for (let i = 0; i < list.length; i++) {
    if (list[i]?.divider) lastDivider = i;
  }
  const effective = lastDivider >= 0 ? list.slice(lastDivider + 1) : list;
  for (const m of effective) {
    if (m.contextExcluded) continue;
    if (m.role === 'system') continue;
    if (m.interrupted) continue;
    // 跳过尚无正文/附件的流式占位（最后一条 assistant 在 send 时才追加）
    if (!m.content && !m.reasoning && !(m.attachments && m.attachments.length)) continue;
    const normalized =
      m.role === 'assistant' ? normalizeAssistantReply(m.content, m.reasoning) : undefined;
    if (m.role === 'assistant' && !normalized?.content.trim()) continue;
    // 带附件的用户消息走多模态 content 数组（文本在前，附件按序在后）；否则保持纯字符串
    if (m.role === 'user' && m.attachments && m.attachments.length) {
      const parts: ChatRequestMessage['content'] = [];
      if (m.content) parts.push({ type: 'text', text: m.content });
      for (const att of m.attachments) parts.push(attachmentToPart(att));
      out.push({ role: m.role, content: parts });
    } else {
      out.push({
        role: m.role,
        content: normalized?.content ?? m.content,
      });
    }
  }
  return out;
}

/** 取会话标题：首条用户消息前 20 字，缺省回退「新对话」 */
export function deriveTitle(list: ChatMessage[]): string {
  const firstUser = list.find((m) => m.role === 'user' && m.content.trim());
  if (!firstUser) return '新对话';
  const text = firstUser.content.trim().replace(/\s+/g, ' ');
  return text.length > 20 ? `${text.slice(0, 20)}…` : text;
}

/**
 * 取某条 assistant 消息对应的「问答对」：向前找最近的用户提问，答为该条正文。
 * 用于反馈上报的内容快照。找不到（异常）时返回空串。
 *
 * @param list 消息列表
 * @param assistantId 目标 assistant 消息 id
 * @returns { question, answer } 文本快照
 */
export function findQAPair(
  list: ChatMessage[],
  assistantId: string,
): {
  question: string;
  answer: string;
  requestId?: string;
  clientRequestId?: string;
  apiKeyId?: string;
} {
  const ai = list.findIndex((m) => m.id === assistantId);
  if (ai < 0) return { question: '', answer: '' };
  const answer = list[ai].content;
  let question = '';
  for (let i = ai - 1; i >= 0; i--) {
    if (list[i].divider) break; // 越过分隔线不再上溯（上下文已清除）
    if (list[i].role === 'user') {
      question = list[i].content;
      break;
    }
  }
  return {
    question,
    answer,
    requestId: list[ai].requestId,
    clientRequestId: list[ai].clientRequestId,
    apiKeyId: list[ai].apiKeyId,
  };
}

/** 从消息顶层「live 字段」抽出一份版本快照（一轮回答完成时调用）。 */
export function snapshotVersion(m: ChatMessage): AnswerVersion {
  const normalized =
    m.role === 'assistant' ? normalizeAssistantReply(m.content, m.reasoning) : undefined;
  return {
    content: normalized?.content ?? m.content,
    ...((normalized?.reasoning ?? m.reasoning)
      ? { reasoning: normalized?.reasoning ?? m.reasoning }
      : {}),
    // 联网过程字段：刷新后折叠区才能重绘工具步骤
    ...(m.searchStatus !== undefined ? { searchStatus: m.searchStatus } : {}),
    ...(m.searchStep ? { searchStep: m.searchStep } : {}),
    ...(m.searchResultCount !== undefined ? { searchResultCount: m.searchResultCount } : {}),
    ...(m.searchActiveTool ? { searchActiveTool: m.searchActiveTool } : {}),
    ...(m.searchBrowseCount !== undefined ? { searchBrowseCount: m.searchBrowseCount } : {}),
    ...(m.searchQueries && m.searchQueries.length ? { searchQueries: m.searchQueries } : {}),
    ...(m.searchTools && m.searchTools.length ? { searchTools: m.searchTools } : {}),
    ...(m.toolEvents && m.toolEvents.length ? { toolEvents: m.toolEvents } : {}),
    ...(m.citations && m.citations.length ? { citations: m.citations } : {}),
    ...(m.usage ? { usage: m.usage } : {}),
    ...(m.metrics ? { metrics: m.metrics } : {}),
    ...(m.requestId ? { requestId: m.requestId } : {}),
    ...(m.clientRequestId ? { clientRequestId: m.clientRequestId } : {}),
    ...(m.apiKeyId ? { apiKeyId: m.apiKeyId } : {}),
    ...(m.error ? { error: m.error } : {}),
    ...(m.interrupted ? { interrupted: true } : {}),
    ...(m.feedback ? { feedback: m.feedback } : {}),
  };
}

/**
 * 把指定版本的字段镜像回消息顶层（切换 ‹n/N› 或加载时调用），保持
 * 「顶层 == versions[activeVersion]」不变式。清掉未在该版本出现的可选字段避免残留。
 */
export function applyVersion(m: ChatMessage, index: number): ChatMessage {
  const v = m.versions?.[index];
  if (!v) return m;
  return {
    ...m,
    content: v.content,
    reasoning: v.reasoning,
    searchStatus: v.searchStatus,
    searchStep: v.searchStep,
    searchResultCount: v.searchResultCount,
    searchActiveTool: v.searchActiveTool,
    searchBrowseCount: v.searchBrowseCount,
    searchQueries: v.searchQueries,
    searchTools: v.searchTools,
    toolEvents: v.toolEvents,
    citations: v.citations,
    usage: v.usage,
    metrics: v.metrics,
    requestId: v.requestId,
    clientRequestId: v.clientRequestId,
    apiKeyId: v.apiKeyId,
    error: v.error,
    interrupted: v.interrupted,
    feedback: v.feedback,
    activeVersion: index,
  };
}

/** 合并字符串列表并去重，保持首次出现顺序。 */
function mergeUniqueStrings(previous: string[] | undefined, incoming: string[]): string[] {
  return [...new Set([...(previous ?? []), ...incoming])];
}
