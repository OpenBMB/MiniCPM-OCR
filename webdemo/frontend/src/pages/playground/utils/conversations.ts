/**
 * 历史对话存储形态 ↔ 前端 ChatMessage 的互转纯函数。
 *
 * 用途：后端 MapStoredMessage（snake_case + 扁平 token 字段）与前端 ChatMessage
 * （含 streaming/usage 等 UI 态）之间映射。无副作用，便于单测。
 */

import type { MapSaveConversationInput, MapStoredMessage, MapStoredVersion } from '@/api/map';
import type { AnswerVersion, ChatMessage } from '../types';
import { CONTEXT_DIVIDER_MARKER, snapshotVersion } from './messages';
import { normalizeAssistantReply } from './thinkSplit';

/** 后端版本存储形态 → 前端 AnswerVersion */
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
  // 联网过程字段：刷新后重绘折叠区使用，与 AnswerProcessTimeline 期望的输入对齐
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

/** 前端 AnswerVersion → 后端版本存储形态 */
function versionToStored(v: AnswerVersion): MapStoredVersion {
  const normalized = normalizeAssistantReply(v.content, v.reasoning);
  return {
    content: normalized.content,
    ...(normalized.reasoning ? { reasoning: normalized.reasoning } : {}),
    ...(v.citations && v.citations.length ? { citations: v.citations } : {}),
    ...(v.feedback ? { feedback: v.feedback } : {}),
    ...(v.interrupted ? { interrupted: true } : {}),
    // 联网过程字段透传，刷新后折叠区才能重绘工具步骤
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

/** 后端存储消息 → 前端 ChatMessage（回填后一律非流式态） */
export function storedToChatMessage(m: MapStoredMessage): ChatMessage {
  // 上下文分隔线：以 system + 标记往返，加载时还原为 divider（content 清空，避免标记泄漏到 UI）
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
  // 回填前端计时指标（首 token 延迟 / 总耗时），使刷新后仍能展示完整指标行
  if (typeof m.first_token_ms === 'number' || typeof m.duration_ms === 'number') {
    msg.metrics = {
      ...(typeof m.first_token_ms === 'number' ? { firstTokenMs: m.first_token_ms } : {}),
      ...(typeof m.duration_ms === 'number' ? { durationMs: m.duration_ms } : {}),
    };
  }
  if (m.citations && m.citations.length) msg.citations = m.citations;
  // 联网过程字段（单版本消息顶层），刷新后折叠区重绘需要
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
  // 回填反馈高亮（当前选中版本的点赞/点踩），使刷新后高亮保留
  if (m.feedback === 'up' || m.feedback === 'down') msg.feedback = m.feedback;
  // 多版本回答：重建 versions + activeVersion（顶层字段已是选中版本的镜像，无需再覆盖）
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
 * 待保存请求体 → 前端消息列表。
 * 用于刷新时恢复 sessionStorage 中尚未完成服务端写入的同标签页草稿。
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
 * 把 UI 消息收敛为自动保存快照。
 * 首次生成的空 assistant 占位不保存；重新生成时恢复当前历史版本，避免流式期间删除旧回答。
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
 * 把 UI 消息收敛为刷新草稿。
 * 首次生成保留空占位或部分正文/思考并标记中断；重新生成保留旧版本及当前部分回答。
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

/** 重新生成尚未返回有效增量时继续使用旧完成版本，不制造空的中断版本。 */
function hasStreamingDraftContent(message: ChatMessage): boolean {
  return Boolean(
    message.content || message.reasoning || message.citations?.length || message.toolEvents?.length,
  );
}

/** 将重新生成中的 assistant 临时恢复为当前历史版本，仅供自动保存计算快照。 */
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
 * 前端消息列表 → 保存请求体（剥离 streaming/error 等 UI 态，展开 usage）。
 * 保留有效消息及显式中断占位，跳过普通空占位与错误消息。
 */
export function chatMessagesToSavePayload(
  messages: ChatMessage[],
  title: string,
  model?: string,
): MapSaveConversationInput {
  const out: MapSaveConversationInput['messages'] = [];
  for (const m of messages) {
    if (m.error) continue;
    // 上下文分隔线：以 system + 标记持久化（content 可能已被清空，需特判保留）
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
      // 联网过程字段（单版本消息顶层）：刷新后折叠区重绘需要
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
      // 持久化前端计时指标，避免刷新后计时项丢失（输出速率由二者派生，无需单独存）
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
      // 中断回答借助现有 alt_versions JSONB 保存状态，避免新增数据库列。
      ...(m.interrupted || (m.versions && m.versions.length > 1)
        ? {
            alt_versions: (m.versions ?? [snapshotVersion(m)]).map(versionToStored),
            active_version: m.activeVersion ?? (m.versions?.length ?? 1) - 1,
          }
        : {}),
      // 反馈高亮：当前选中版本的点赞/点踩（单版本与多版本均存顶层，刷新后保留高亮）
      ...(m.feedback ? { feedback: m.feedback } : {}),
    });
  }
  return { title, model, messages: out };
}

/**
 * 计算消息列表签名，判断相较上次保存有无变化以避免重复写库：角色 + 正文/思考长度 + 版本数/选中索引
 * + 逐个工具事件的 eventId~status~来源数（同 eventId 原地转 success 时条数不变，但正是它带来 citationUrls）。
 */
export function messagesSignature(messages: ChatMessage[]): string {
  return messages
    .map(
      (m) =>
        `${m.role}:${m.content.length}:${m.reasoning?.length ?? 0}:${m.citations?.length ?? 0}:${m.attachments?.length ?? 0}:${m.requestId ?? ''}:${m.clientRequestId ?? ''}:${m.apiKeyId ?? ''}:${m.error ? 1 : 0}:${m.contextExcluded ? 1 : 0}:${m.versions?.length ?? 1}:${m.activeVersion ?? 0}:${m.feedback ?? ''}:${m.searchStep ?? ''}:${m.searchActiveTool ?? ''}:${m.searchTools?.length ?? 0}:${m.searchQueries?.length ?? 0}:${m.searchResultCount ?? ''}:${m.searchBrowseCount ?? ''}:${m.toolEvents?.map((e) => `${e.eventId}~${e.status}~${e.citationUrls?.length ?? 0}`).join(',') ?? ''}`,
    )
    .join('|');
}
