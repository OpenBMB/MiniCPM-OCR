/**
 * Pure functions that build conversation messages and merge increments.
 *
 * Purpose: collapse useChat message-state transforms into side-effect-free pure functions, so they can be reused and unit tested.
 */

import type { AnswerVersion, ChatMessage, ChatRole, Citation } from '../types';
import type { ChatRequestMessage } from '@/api/map/chat';
import { attachmentToPart } from './attachments';
import { citationURLKey } from './citations';
import { buildContextWindowPlan, type ContextWindowOptions } from './contextBudget';
import { normalizeAssistantReply } from './thinkSplit';

/**
 * Storage marker for a context divider.
 * On the frontend a divider is identified by `divider:true`; persistence has no separate field, so it round-trips as role='system' plus this marker,
 * and on load the divider flag is restored from that (see conversations.ts).
 */
export const CONTEXT_DIVIDER_MARKER = '[[map:context-cleared]]';

/** Generate a lightweight unique id (no crypto needed; enough for frontend dedupe and keys) */
export function genId(seed: number): string {
  return `m_${seed.toString(36)}_${(seed % 1000).toString(36)}`;
}

/** Build a context-divider message (role=system so it stays out of the request by default; content uses a marker so it can round-trip through persistence) */
export function makeDivider(id: string): ChatMessage {
  return { id, role: 'system', content: CONTEXT_DIVIDER_MARKER, divider: true };
}

/**
 * Build one message.
 * @param id unique id
 * @param role role
 * @param content body
 * @param extra extra fields (streaming, reasoning, and so on)
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
 * Merge a streaming increment into the message with the given id (functional update, immutable).
 *
 * @param list current message list
 * @param id target assistant message id
 * @param patch content to merge or append (content and reasoning are appended; other fields overwrite)
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
    // Citation sources are merged and deduped by url (streaming may carry the same source on several frames)
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
    // metrics are merged incrementally: keep existing fields, and overwrite only what this update provides (time to first token and total elapsed arrive separately)
    if (patch.metrics !== undefined) next.metrics = { ...m.metrics, ...patch.metrics };
    if (patch.error !== undefined) next.error = patch.error;
    return next;
  });
}

/**
 * Merge citation sources and dedupe them; keep first-seen order, and keep the fuller metadata a later tool returns.
 *
 * Identity prefers the backend number ref: it is bound one-to-one with the URL across turns and tools, and is more accurate than any frontend normalization.
 * When there is no ref (an old backend), fall back to citationURLKey — this used to be the raw url, a different measure from elsewhere (marker matching,
 * source-panel highlight). One trailing slash would then produce an extra duplicate source.
 *
 * @param prev sources already accumulated
 * @param incoming sources brought by this event
 * @returns the merged source list; when every item has a ref, sorted by ref ascending so list numbers stay contiguous
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
        // ref backfill: the same source may arrive first on a channel with no number, and a later event fills the number in.
        ...(!existing.ref && c.ref ? { ref: c.ref } : {}),
        ...(!existing.title && c.title ? { title: c.title } : {}),
        ...(preferLongerText(existing.snippet, c.snippet) ? { snippet: c.snippet } : {}),
      };
      continue;
    }
    indexByIdentity.set(citationIdentity(c), merged.length);
    merged.push(c);
  }
  // When every item has a number, sort by number: the source panel displays ref, and an array order that disagrees with the numbers would read as 1, 2, 5, 3.
  // If even one item has no number, do not sort, so the "no number" item is not pushed into a position it does not belong to.
  if (merged.length > 0 && merged.every((c) => Boolean(c.ref))) {
    merged.sort((a, b) => (a.ref ?? 0) - (b.ref ?? 0));
  }
  return merged;
}

/** Dedup identity of a source: use the backend number when present, otherwise the normalized URL key. */
function citationIdentity(citation: Citation): string {
  return citation.ref ? `ref:${citation.ref}` : `url:${citationURLKey(citation.url)}`;
}

/** When a later page-read body is fuller than the search snippet, fill the preview with the longer text. */
function preferLongerText(current?: string, incoming?: string): incoming is string {
  return Boolean(incoming && incoming.length > (current?.length ?? 0));
}

/**
 * Turn this page's message history into the minimum structure the backend request needs (role + content only, dropping empty streaming placeholders).
 *
 * @param list this page's message list
 * @param systemPrompt optional system prompt, placed first
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
  // Context truncation: take only messages after the last divider (history above the divider is no longer sent as context)
  let lastDivider = -1;
  for (let i = 0; i < list.length; i++) {
    if (list[i]?.divider) lastDivider = i;
  }
  const effective = lastDivider >= 0 ? list.slice(lastDivider + 1) : list;
  for (const m of effective) {
    if (m.contextExcluded) continue;
    if (m.role === 'system') continue;
    if (m.interrupted) continue;
    // Skip streaming placeholders that have no body or attachment yet (the last assistant is appended only at send time)
    if (!m.content && !m.reasoning && !(m.attachments && m.attachments.length)) continue;
    const normalized =
      m.role === 'assistant' ? normalizeAssistantReply(m.content, m.reasoning) : undefined;
    if (m.role === 'assistant' && !normalized?.content.trim()) continue;
    // A user message with attachments uses a multimodal content array (text first, then attachments in order); otherwise keep a plain string
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

/** Conversation title: the first 20 characters of the first user message, falling back to "New conversation" when absent */
export function deriveTitle(list: ChatMessage[]): string {
  const firstUser = list.find((m) => m.role === 'user' && m.content.trim());
  if (!firstUser) return '新对话';
  const text = firstUser.content.trim().replace(/\s+/g, ' ');
  return text.length > 20 ? `${text.slice(0, 20)}…` : text;
}

/**
 * Take the "question-answer pair" for one assistant message: look backward for the nearest user question, and the answer is that message's body.
 * Used as the content snapshot for feedback reporting. Return empty strings when it cannot be found (an abnormal case).
 *
 * @param list message list
 * @param assistantId target assistant message id
 * @returns { question, answer } text snapshot
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
    if (list[i].divider) break; // Do not walk back past a divider (the context has been cleared)
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

/** Pull a version snapshot out of the message's top-level "live fields" (called when one answer finishes). */
export function snapshotVersion(m: ChatMessage): AnswerVersion {
  const normalized =
    m.role === 'assistant' ? normalizeAssistantReply(m.content, m.reasoning) : undefined;
  return {
    content: normalized?.content ?? m.content,
    ...((normalized?.reasoning ?? m.reasoning)
      ? { reasoning: normalized?.reasoning ?? m.reasoning }
      : {}),
    // Web-search process fields: the disclosure needs them to redraw tool steps after refresh
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
 * Mirror the given version's fields back onto the top level of the message (called when switching ‹n/N› or on load), keeping
 * the invariant "top level == versions[activeVersion]". Clear optional fields that do not appear on that version so they do not linger.
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

/** Merge string lists and dedupe them, keeping first-seen order. */
function mergeUniqueStrings(previous: string[] | undefined, incoming: string[]): string[] {
  return [...new Set([...(previous ?? []), ...incoming])];
}
