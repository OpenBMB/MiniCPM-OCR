/**
 * Pure functions converting stored conversation history ↔ frontend ChatMessage.
 *
 * Purpose: map backend MapStoredMessage (snake_case + flat token fields) and frontend ChatMessage
 * (UI state such as streaming/usage). No side effects, so it is easy to unit test.
 */

import type { MapSaveConversationInput, MapStoredMessage, MapStoredVersion } from '@/api/map';
import type { AnswerVersion, ChatMessage } from '../types';
import { CONTEXT_DIVIDER_MARKER, snapshotVersion } from './messages';
import { normalizeAssistantReply } from './thinkSplit';

/** Backend stored version → frontend AnswerVersion */
function storedToVersion(v: MapStoredVersion): AnswerVersion {
  const normalized = normalizeAssistantReply(v.content, v.reasoning);
  const out: AnswerVersion = { content: normalized.content };
  if (normalized.reasoning) out.reasoning = normalized.reasoning;
  if (v.citations && v.citations.length) out.citations = v.citations;
  if (v.feedback) out.feedback = v.feedback;
  if (v.request_id) out.requestId = v.request_id;
  if (v.client_request_id) out.clientRequestId = v.client_request_id;
  if (v.api_key_id) out.apiKeyId = v.api_key_id;
  if (v.interrupted) out.interrupted = true;
  // Web-search process fields: used to redraw the disclosure after refresh, aligned with the input AnswerProcessTimeline expects
  if (v.search_status !== undefined) out.searchStatus = v.search_status;
  if (v.search_step) out.searchStep = v.search_step as AnswerVersion['searchStep'];
  if (v.search_result_count !== undefined) out.searchResultCount = v.search_result_count;
  if (v.search_active_tool) out.searchActiveTool = v.search_active_tool;
  if (v.search_browse_count !== undefined) out.searchBrowseCount = v.search_browse_count;
  if (v.search_queries?.length) out.searchQueries = v.search_queries;
  if (v.search_tools?.length) out.searchTools = v.search_tools;
  if (v.tool_events?.length) out.toolEvents = v.tool_events;
  if (typeof v.total_tokens === 'number') {
    out.usage = {
      prompt_tokens: v.prompt_tokens ?? 0,
      completion_tokens: v.completion_tokens ?? 0,
      total_tokens: v.total_tokens,
    };
  }
  if (typeof v.first_token_ms === 'number' || typeof v.duration_ms === 'number') {
    out.metrics = {
      ...(typeof v.first_token_ms === 'number' ? { firstTokenMs: v.first_token_ms } : {}),
      ...(typeof v.duration_ms === 'number' ? { durationMs: v.duration_ms } : {}),
    };
  }
  return out;
}

/** Frontend AnswerVersion → backend stored version */
function versionToStored(v: AnswerVersion): MapStoredVersion {
  const normalized = normalizeAssistantReply(v.content, v.reasoning);
  return {
    content: normalized.content,
    ...(normalized.reasoning ? { reasoning: normalized.reasoning } : {}),
    ...(v.citations && v.citations.length ? { citations: v.citations } : {}),
    ...(v.feedback ? { feedback: v.feedback } : {}),
    ...(v.interrupted ? { interrupted: true } : {}),
    // Pass web-search process fields through, so the disclosure can redraw tool steps after refresh
    ...(v.searchStatus !== undefined ? { search_status: v.searchStatus } : {}),
    ...(v.searchStep ? { search_step: v.searchStep } : {}),
    ...(v.searchResultCount !== undefined ? { search_result_count: v.searchResultCount } : {}),
    ...(v.searchActiveTool ? { search_active_tool: v.searchActiveTool } : {}),
    ...(v.searchBrowseCount !== undefined ? { search_browse_count: v.searchBrowseCount } : {}),
    ...(v.searchQueries && v.searchQueries.length ? { search_queries: v.searchQueries } : {}),
    ...(v.searchTools && v.searchTools.length ? { search_tools: v.searchTools } : {}),
    ...(v.toolEvents && v.toolEvents.length ? { tool_events: v.toolEvents } : {}),
    ...(v.usage
      ? {
          prompt_tokens: v.usage.prompt_tokens,
          completion_tokens: v.usage.completion_tokens,
          total_tokens: v.usage.total_tokens,
        }
      : {}),
    ...(v.metrics?.firstTokenMs !== undefined
      ? { first_token_ms: Math.round(v.metrics.firstTokenMs) }
      : {}),
    ...(v.metrics?.durationMs !== undefined
      ? { duration_ms: Math.round(v.metrics.durationMs) }
      : {}),
    ...(v.requestId ? { request_id: v.requestId } : {}),
    ...(v.clientRequestId ? { client_request_id: v.clientRequestId } : {}),
    ...(v.apiKeyId ? { api_key_id: v.apiKeyId } : {}),
  };
}

/** Backend stored message → frontend ChatMessage (always non-streaming after backfill) */
export function storedToChatMessage(m: MapStoredMessage): ChatMessage {
  // Context divider: round-trips as system + a marker, and is restored as a divider on load (content cleared so the marker does not leak into the UI)
  if (m.role === 'system' && m.content === CONTEXT_DIVIDER_MARKER) {
    return { id: m.id, role: 'system', content: '', streaming: false, divider: true };
  }
  const normalized =
    m.role === 'assistant' ? normalizeAssistantReply(m.content, m.reasoning) : undefined;
  const msg: ChatMessage = {
    id: m.id,
    role: m.role,
    content: normalized?.content ?? m.content,
    streaming: false,
  };
  if (normalized?.reasoning) msg.reasoning = normalized.reasoning;
  if (m.request_id) msg.requestId = m.request_id;
  if (m.client_request_id) msg.clientRequestId = m.client_request_id;
  if (m.api_key_id) msg.apiKeyId = m.api_key_id;
  if (typeof m.total_tokens === 'number') {
    msg.usage = {
      prompt_tokens: m.prompt_tokens ?? 0,
      completion_tokens: m.completion_tokens ?? 0,
      total_tokens: m.total_tokens,
    };
  }
  // Backfill frontend timing metrics (time to first token / total elapsed) so the full metrics row still shows after refresh
  if (typeof m.first_token_ms === 'number' || typeof m.duration_ms === 'number') {
    msg.metrics = {
      ...(typeof m.first_token_ms === 'number' ? { firstTokenMs: m.first_token_ms } : {}),
      ...(typeof m.duration_ms === 'number' ? { durationMs: m.duration_ms } : {}),
    };
  }
  if (m.citations && m.citations.length) msg.citations = m.citations;
  // Web-search process fields (top level of a single-version message), needed to redraw the disclosure after refresh
  if (m.search_status !== undefined) msg.searchStatus = m.search_status;
  if (m.search_step) msg.searchStep = m.search_step as ChatMessage['searchStep'];
  if (m.search_result_count !== undefined) msg.searchResultCount = m.search_result_count;
  if (m.search_active_tool) msg.searchActiveTool = m.search_active_tool;
  if (m.search_browse_count !== undefined) msg.searchBrowseCount = m.search_browse_count;
  if (m.search_queries?.length) msg.searchQueries = m.search_queries;
  if (m.search_tools?.length) msg.searchTools = m.search_tools;
  if (m.tool_events?.length) msg.toolEvents = m.tool_events;
  if (m.context_excluded) msg.contextExcluded = true;
  if (m.attachments && m.attachments.length) {
    msg.attachments = m.attachments.map((att) => ({
      id: att.id,
      kind: att.kind,
      name: att.name,
      mime: att.mime,
      size: att.size,
      dataUrl: att.dataUrl || att.proxyUrl || att.url || '',
      ...(att.url ? { url: att.url } : {}),
      ...(att.proxyUrl ? { proxyUrl: att.proxyUrl } : {}),
      ...(att.publicUrl ? { publicUrl: att.publicUrl } : {}),
      ...(att.objectKey ? { objectKey: att.objectKey } : {}),
    }));
  }
  // Backfill feedback highlight (like/dislike on the selected version) so the highlight survives refresh
  if (m.feedback === 'up' || m.feedback === 'down') msg.feedback = m.feedback;
  // Multi-version answers: rebuild versions + activeVersion (top-level fields are already a mirror of the selected version and do not need another overwrite)
  if (m.alt_versions && m.alt_versions.length > 0) {
    msg.versions = m.alt_versions.map(storedToVersion);
    msg.activeVersion =
      typeof m.active_version === 'number' &&
      m.active_version >= 0 &&
      m.active_version < msg.versions.length
        ? m.active_version
        : msg.versions.length - 1;
    msg.interrupted = msg.versions[msg.activeVersion]?.interrupted;
  }
  return msg;
}

/**
 * Pending save request body → frontend message list.
 * Used on refresh to restore a same-tab draft in sessionStorage that has not finished writing to the server.
 */
export function savePayloadToChatMessages(payload: MapSaveConversationInput): ChatMessage[] {
  return payload.messages.map((message, index) =>
    storedToChatMessage({
      ...message,
      id: `draft-${index}`,
      created_at: '',
    }),
  );
}

/**
 * Collapse UI messages into an autosave snapshot.
 * An empty assistant placeholder from the first generation is not saved; during regenerate, restore the current history version so the old answer is not deleted while streaming.
 */
export function messagesForAutosave(messages: ChatMessage[]): ChatMessage[] {
  return messages.flatMap((message) => {
    if (!message.streaming) return [message];
    if (message.role !== 'assistant' || !message.versions?.length) return [];

    const index =
      message.activeVersion !== undefined &&
      message.activeVersion >= 0 &&
      message.activeVersion < message.versions.length
        ? message.activeVersion
        : message.versions.length - 1;
    const version = message.versions[index];
    if (!version) return [];
    return [restoreVersionForAutosave(message, version, index)];
  });
}

/**
 * Collapse UI messages into a refresh draft.
 * The first generation keeps an empty placeholder or a partial body/reasoning and marks it interrupted; regenerate keeps the old version and the current partial answer.
 */
export function messagesForDraft(messages: ChatMessage[]): ChatMessage[] {
  return messages.flatMap((message) => {
    if (!message.streaming) return [message];
    if (message.role !== 'assistant') return [];
    if (message.versions?.length) {
      if (!hasStreamingDraftContent(message)) {
        return messagesForAutosave([message]);
      }
      const interruptedVersion = snapshotVersion({ ...message, interrupted: true });
      return [
        {
          ...message,
          streaming: false,
          searching: false,
          interrupted: true,
          versions: [...message.versions, interruptedVersion],
          activeVersion: message.versions.length,
        },
      ];
    }
    return [
      {
        ...message,
        streaming: false,
        searching: false,
        interrupted: true,
      },
    ];
  });
}

/** Before regenerate has returned a useful increment, keep using the old completed version, and do not invent an empty interrupted version. */
function hasStreamingDraftContent(message: ChatMessage): boolean {
  return Boolean(
    message.content || message.reasoning || message.citations?.length || message.toolEvents?.length,
  );
}

/** Temporarily restore an assistant that is being regenerated to the current history version, only so autosave can compute a snapshot. */
function restoreVersionForAutosave(
  message: ChatMessage,
  version: AnswerVersion,
  activeVersion: number,
): ChatMessage {
  return {
    ...message,
    content: version.content,
    reasoning: version.reasoning,
    searchStatus: version.searchStatus,
    searchStep: version.searchStep,
    searchResultCount: version.searchResultCount,
    searchActiveTool: version.searchActiveTool,
    searchBrowseCount: version.searchBrowseCount,
    searchQueries: version.searchQueries,
    searchTools: version.searchTools,
    toolEvents: version.toolEvents,
    citations: version.citations,
    usage: version.usage,
    metrics: version.metrics,
    requestId: version.requestId,
    error: version.error,
    interrupted: version.interrupted,
    feedback: version.feedback,
    activeVersion,
    streaming: false,
    searching: false,
  };
}

/**
 * Frontend message list → save request body (strip UI state such as streaming/error, and expand usage).
 * Keep valid messages and explicit interrupted placeholders, and skip ordinary empty placeholders and error messages.
 */
export function chatMessagesToSavePayload(
  messages: ChatMessage[],
  title: string,
  model?: string,
): MapSaveConversationInput {
  const out: MapSaveConversationInput['messages'] = [];
  for (const m of messages) {
    if (m.error) continue;
    // Context divider: persist as system + a marker (content may already have been cleared, so it has to be kept by a special case)
    if (m.divider) {
      out.push({ role: 'system', content: CONTEXT_DIVIDER_MARKER });
      continue;
    }
    if (
      !m.content &&
      !m.reasoning &&
      !(m.citations && m.citations.length) &&
      !(m.attachments && m.attachments.length) &&
      !m.interrupted
    )
      continue;
    const normalized =
      m.role === 'assistant' ? normalizeAssistantReply(m.content, m.reasoning) : undefined;
    out.push({
      role: m.role,
      content: normalized?.content ?? m.content,
      ...(m.attachments && m.attachments.length
        ? {
            attachments: m.attachments.map((att) => ({
              id: att.id,
              kind: att.kind,
              name: att.name,
              mime: att.mime,
              size: att.size,
              ...(att.url ? { url: att.url } : {}),
              ...(att.proxyUrl ? { proxyUrl: att.proxyUrl } : {}),
              ...(att.publicUrl ? { publicUrl: att.publicUrl } : {}),
              ...(att.objectKey ? { objectKey: att.objectKey } : {}),
            })),
          }
        : {}),
      ...((normalized?.reasoning ?? m.reasoning)
        ? { reasoning: normalized?.reasoning ?? m.reasoning }
        : {}),
      ...(m.citations && m.citations.length ? { citations: m.citations } : {}),
      // Web-search process fields (top level of a single-version message): needed to redraw the disclosure after refresh
      ...(m.searchStatus !== undefined ? { search_status: m.searchStatus } : {}),
      ...(m.searchStep ? { search_step: m.searchStep } : {}),
      ...(m.searchResultCount !== undefined ? { search_result_count: m.searchResultCount } : {}),
      ...(m.searchActiveTool ? { search_active_tool: m.searchActiveTool } : {}),
      ...(m.searchBrowseCount !== undefined ? { search_browse_count: m.searchBrowseCount } : {}),
      ...(m.searchQueries && m.searchQueries.length ? { search_queries: m.searchQueries } : {}),
      ...(m.searchTools && m.searchTools.length ? { search_tools: m.searchTools } : {}),
      ...(m.toolEvents && m.toolEvents.length ? { tool_events: m.toolEvents } : {}),
      ...(m.usage
        ? {
            prompt_tokens: m.usage.prompt_tokens,
            completion_tokens: m.usage.completion_tokens,
            total_tokens: m.usage.total_tokens,
          }
        : {}),
      // Persist frontend timing metrics, so timing items are not lost after refresh (output rate is derived from the two and does not need to be stored on its own)
      ...(m.metrics?.firstTokenMs !== undefined
        ? { first_token_ms: Math.round(m.metrics.firstTokenMs) }
        : {}),
      ...(m.metrics?.durationMs !== undefined
        ? { duration_ms: Math.round(m.metrics.durationMs) }
        : {}),
      ...(m.requestId ? { request_id: m.requestId } : {}),
      ...(m.clientRequestId ? { client_request_id: m.clientRequestId } : {}),
      ...(m.apiKeyId ? { api_key_id: m.apiKeyId } : {}),
      ...(m.contextExcluded ? { context_excluded: true } : {}),
      // An interrupted answer saves its state through the existing alt_versions JSONB, so no new database column is added.
      ...(m.interrupted || (m.versions && m.versions.length > 1)
        ? {
            alt_versions: (m.versions ?? [snapshotVersion(m)]).map(versionToStored),
            active_version: m.activeVersion ?? (m.versions?.length ?? 1) - 1,
          }
        : {}),
      // Feedback highlight: like/dislike on the currently selected version (stored at the top level for both single-version and multi-version, so the highlight survives refresh)
      ...(m.feedback ? { feedback: m.feedback } : {}),
    });
  }
  return { title, model, messages: out };
}

/**
 * Compute a message-list signature, to decide whether anything changed since the last save and avoid writing the database again: role + body/reasoning length + version count/selected index
 * + each tool event's eventId~status~source count (an in-place change of the same eventId to success does not change the count, but that is exactly what brings citationUrls).
 */
export function messagesSignature(messages: ChatMessage[]): string {
  return messages
    .map(
      (m) =>
        `${m.role}:${m.content.length}:${m.reasoning?.length ?? 0}:${m.citations?.length ?? 0}:${m.attachments?.length ?? 0}:${m.requestId ?? ''}:${m.clientRequestId ?? ''}:${m.apiKeyId ?? ''}:${m.error ? 1 : 0}:${m.contextExcluded ? 1 : 0}:${m.versions?.length ?? 1}:${m.activeVersion ?? 0}:${m.feedback ?? ''}:${m.searchStep ?? ''}:${m.searchActiveTool ?? ''}:${m.searchTools?.length ?? 0}:${m.searchQueries?.length ?? 0}:${m.searchResultCount ?? ''}:${m.searchBrowseCount ?? ''}:${m.toolEvents?.map((e) => `${e.eventId}~${e.status}~${e.citationUrls?.length ?? 0}`).join(',') ?? ''}`,
    )
    .join('|');
}
