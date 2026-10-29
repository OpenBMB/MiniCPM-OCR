/**
 * Streaming chat API for the MAP experience center (Playground).
 *
 * Purpose: call L2’s OpenAI-compatible `/v1/chat/completions` directly (SSE streaming), using the user’s plaintext API Key as
 * `Bearer` auth. Do **not** reuse `mapRequest`: it unwraps the L3 envelope and throws BizError, which does not fit a raw SSE stream.
 *
 * Security: secret (plaintext lis_sk_xxx) is passed in memory by the caller only. This module does not persist or print it.
 */

import { getToken } from './request';
import {
  splitSseFrames,
  parseSseFrame,
  extractDeltas,
  normalizeCitations,
  createThinkSplitState,
  splitThinkDelta,
  flushThinkDelta,
  type ThinkSplitState,
} from '@/pages/playground/utils/sse';

/**
 * Chat endpoint base URL: at deploy time prefer `VITE_CHAT_BASE_URL` injected per environment.
 * When that value is missing, fall back by `VITE_AUTH_PROFILE`: GCP uses `https://api.modelbest.ai`,
 * and legacy uses `https://api.modelbest.cn`, so the two cloud hostnames do not cross.
 * Note that `/api` is the L3 control-plane prefix (it has no `/v1/chat/completions`, and a direct call returns 405). Chat must go through L2.
 */
const configuredChatAPIBase = import.meta.env.VITE_CHAT_BASE_URL?.trim();
export const CHAT_API_BASE =
  configuredChatAPIBase ||
  (import.meta.env.VITE_AUTH_PROFILE === 'gcp'
    ? 'https://api.modelbest.ai'
    : 'https://api.modelbest.cn');

/** Token usage */
export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/**
 * OpenAI-compatible multimodal content parts. Media prefers object-storage URLs, and data URL/file_data remain for compatibility.
 * - image_url / video_url: URL form (OpenAI-compatible vision models such as Qwen-VL carry video in video_url)
 * - input_audio: OpenAI Chat Completions audio input (data is raw base64 **without** the prefix, plus format)
 * - file: OpenAI file input (file_data is a full data URL; filename is for upstream type recognition)
 */
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'video_url'; video_url: { url: string } }
  | { type: 'input_audio'; input_audio: { data: string; format: string } }
  | { type: 'file'; file: { filename: string; file_data?: string; file_url?: string } };

/** One chat message sent to the backend; content is a string or an array of multimodal parts */
export interface ChatRequestMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatContentPart[];
}

/**
 * Chat completion parameters. Everything except model/messages is optional, and the backend passes them through to LIS as-is.
 * An index signature reserves undeclared fields such as tools / web_search / response_format.
 */
export interface ChatCompletionParams {
  model: string;
  messages: ChatRequestMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  reasoning_effort?: 'low' | 'medium' | 'high';
  thinking?: { type: 'enabled' | 'disabled' } | Record<string, unknown>;
  /** MiniCPM/LIS reasoning switch: chat_template_kwargs.enable_thinking (default true) */
  chat_template_kwargs?: { enable_thinking?: boolean } & Record<string, unknown>;
  /** MiniCPM-V-4.7 image compression parameters; sent only when the user selects them explicitly. */
  mm_processor_kwargs?: { downsample_mode?: '4x' | '16x' } & Record<string, unknown>;
  /** Kept as a compatibility field type; Playground hosted web search no longer sends this field from the frontend */
  web_search_options?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Web-search citation source (normalized url_citation) */
export interface Citation {
  /** Global source number assigned by the backend (starting at 1); see the field of the same name in pages/playground/types.ts. */
  ref?: number;
  url: string;
  title?: string;
  snippet?: string;
}

/** Browser runtime context hints carried on a Playground request. */
export interface PlaygroundRuntimeContext {
  timezone?: string;
  locale: 'zh-CN' | 'en-US';
  utc_offset_minutes: number;
  /** Current location set manually by the user (for example "Beijing"), used by the datetime tool to answer location questions. */
  location?: string;
}

/** Streaming callback set */
export interface StreamCallbacks {
  /** Body delta (choices[].delta.content) */
  onContent: (delta: string) => void;
  /** Reasoning delta (reasoning_content / reasoning / thinking) */
  onReasoning?: (delta: string) => void;
  /** Web-search citation sources (url_citation annotations; they may arrive more than once while streaming, so take the union) */
  onCitations?: (citations: Citation[]) => void;
  /** Hosted web search tool status event */
  onToolStatus?: (status: ToolStatusEvent) => void;
  /** Platform L2 request ID for the current answer */
  onRequestId?: (requestId: string) => void;
  /** The current answer was produced by the input content-safety service, and this turn must not enter later model context. */
  onModerationAnswer?: () => void;
  /** Trailing usage chunk (the backend already forces include_usage) */
  onUsage?: (usage: TokenUsage) => void;
  /** Upstream finish reason, so document recognition can tell a complete result from an output-length limit. */
  onFinishReason?: (reason: string) => void;
  /** Normal completion (received [DONE]) */
  onDone?: () => void;
}

/** Hosted web search tool status event */
export interface ToolStatusEvent {
  event_id?: string;
  step?: number;
  tool?: string;
  status?: string;
  queries?: string[];
  urls?: string[];
  result_count?: number;
  duration_ms?: number;
  message?: string;
}

/**
 * Generate the client correlation ID for an experience-center conversation.
 *
 * Purpose: direct calls pass it to L2 via `X-Request-Id`, and web calls pass it to L3 to record the final call mapping;
 * both are only a `client_request_id`. The platform still generates and returns the authoritative `req_xxx` itself.
 */
export function createPlaygroundClientRequestID(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `map_playground_${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
}

/** Chat error that carries an HTTP status code, so the caller can distinguish 401/404/429 */
export class ChatError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ChatError';
    this.status = status;
    this.code = code;
  }
}

/** Read the current login token (attach portal auth when going through the /api same-origin proxy, without changing L2 Bearer auth) */
function buildUrl(): string {
  return `${CHAT_API_BASE}/v1/chat/completions`;
}

/**
 * Split a body delta on `<think>` and dispatch it: route think segments to the reasoning channel and keep the body clean.
 * See sse.ts: some models (on the web path with tools, upstream no longer separates reasoning) inline reasoning in content.
 */
function emitContentDelta(
  state: ThinkSplitState,
  content: string,
  callbacks: StreamCallbacks,
): void {
  const split = splitThinkDelta(state, content);
  if (split.content) callbacks.onContent(split.content);
  if (split.reasoning) callbacks.onReasoning?.(split.reasoning);
}

/** When the stream ends, flush leftover `<think>` split state and dispatch it, so a partial tag or an unclosed think does not swallow text. */
function drainThink(state: ThinkSplitState, callbacks: StreamCallbacks): void {
  const rest = flushThinkDelta(state);
  if (rest.content) callbacks.onContent(rest.content);
  if (rest.reasoning) callbacks.onReasoning?.(rest.reasoning);
}

/**
 * Start one streaming chat and callback chunk by chunk.
 *
 * @param params Chat parameters (this function forces stream=true)
 * @param secret Plaintext API Key (Bearer), passed in memory only and not written to disk
 * @param callbacks Streaming callbacks
 * @param signal AbortController.signal, used for Stop generating
 * @throws ChatError when upstream returns non-2xx (including 401 for an invalid key, 404 for a path problem, and 429 for rate limiting)
 * @throws DOMException(AbortError) when the caller aborts — the caller should treat that as a normal stop, not an error
 */
export async function streamChat(
  params: ChatCompletionParams,
  secret: string,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  clientRequestID?: string,
  runtimeContext?: PlaygroundRuntimeContext,
): Promise<void> {
  const res = await fetch(buildUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(getToken() ? { 'X-Map-Portal-Token': `Bearer ${getToken()}` } : {}),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'X-Map-Playground-Experience': 'language',
      ...(clientRequestID ? { 'X-Request-Id': clientRequestID } : {}),
      ...playgroundRuntimeContextHeaders(runtimeContext),
    },
    body: JSON.stringify({ ...params, stream: true }),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new ChatError(res.status, mapErrorMessage(res.status, text), extractUpstreamCode(text));
  }
  if (!isEventStreamResponse(res)) {
    const text = await res.text().catch(() => '');
    throw new ChatError(res.status, mapErrorMessage(res.status, text), extractUpstreamCode(text));
  }
  emitResponseMetadata(res, callbacks);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const think = createThinkSplitState();
  let buffer = '';
  let terminalUsageSeen = false;

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = splitSseFrames(buffer);
      buffer = rest;
      for (const frame of frames) {
        const event = parseSseFrame(frame);
        if (!event) continue;
        if (event.type === 'done') {
          drainThink(think, callbacks);
          callbacks.onDone?.();
          return;
        }
        if (event.type === 'error') {
          const failure = streamErrorDetails(event.data);
          throw new ChatError(0, failure.message, failure.code);
        }
        if (event.type === 'request_id') {
          const requestID = extractRequestID(event.data);
          if (requestID) callbacks.onRequestId?.(requestID);
          continue;
        }
        if (event.type === 'moderation') {
          // A revoke frame must interrupt this turn immediately: after the throw, the caller cancels the typewriter queue and clears rendered content,
          // so no model body appears on screen after revoke.
          if (isModerationRevokeEvent(event.data)) {
            throw new ChatError(0, moderationRevokeMessage(event.data), 'content_policy_violation');
          }
          if (isModerationAnswerEvent(event.data)) callbacks.onModerationAnswer?.();
          continue;
        }
        if (event.type === 'citations') {
          const cited = normalizeCitations(event.data);
          if (cited.length) callbacks.onCitations?.(cited);
          continue;
        }
        const { content, reasoning, usage, citations } = extractDeltas(event.data);
        emitFinishReason(event.data, callbacks);
        if (content) emitContentDelta(think, content, callbacks);
        if (reasoning) callbacks.onReasoning?.(reasoning);
        if (citations && citations.length) callbacks.onCitations?.(citations);
        if (usage) callbacks.onUsage?.(usage);
        if (isTerminalUsageChunk(event.data)) terminalUsageSeen = true;
      }
    }
    if (terminalUsageSeen) {
      drainThink(think, callbacks);
      callbacks.onDone?.();
      return;
    }
    throw new ChatError(0, '对话流意外中断，请重试');
  } finally {
    // On abort or error, cancel the underlying read to avoid a connection leak
    void reader.cancel().catch(() => undefined);
  }
}

/** Pass through the real upstream finish reason without changing existing chat-completion semantics. */
function emitFinishReason(data: unknown, callbacks: StreamCallbacks): void {
  if (!data || typeof data !== 'object' || !('choices' in data)) return;
  if (!Array.isArray(data.choices)) return;
  for (const choice of data.choices) {
    if (choice && typeof choice.finish_reason === 'string') {
      callbacks.onFinishReason?.(choice.finish_reason);
    }
  }
}

/**
 * Start one Playground hosted web search streaming chat.
 * @param params Chat parameters (this function forces stream=true)
 * @param apiKeyId API Key ID the server can verify; when empty, the backend chooses by its default rule
 * @param callbacks Streaming callbacks
 * @param signal AbortController.signal
 */
export async function streamPlaygroundWebSearch(
  params: ChatCompletionParams,
  apiKeyId: string | undefined,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  clientRequestID?: string,
  runtimeContext?: PlaygroundRuntimeContext,
  enabledTools?: string[],
): Promise<void> {
  const token = getToken();
  const res = await fetch('/api/playground/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: token ? `Bearer ${token}` : '',
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      // Same as the direct path: runtime context goes in restricted request headers and is not exposed in the hosted request body.
      ...playgroundRuntimeContextHeaders(runtimeContext, { includeLocation: true }),
    },
    body: JSON.stringify({
      ...params,
      api_key_id: apiKeyId || undefined,
      client_request_id: clientRequestID || undefined,
      enabled_tools: enabledTools,
      stream: true,
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new ChatError(res.status, mapErrorMessage(res.status, text), extractUpstreamCode(text));
  }
  if (!isEventStreamResponse(res)) {
    const text = await res.text().catch(() => '');
    throw new ChatError(res.status, mapErrorMessage(res.status, text), extractUpstreamCode(text));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const think = createThinkSplitState();
  let buffer = '';

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = splitSseFrames(buffer);
      buffer = rest;
      for (const frame of frames) {
        const event = parseSseFrame(frame);
        if (!event) continue;
        if (event.type === 'done') {
          drainThink(think, callbacks);
          callbacks.onDone?.();
          return;
        }
        // In-band error frame: after SSE has started the BFF cannot change the HTTP status, so it carries the error in event: error.
        // Throw so the caller’s catch records the error state, instead of treating it as ordinary status that is cleared after [DONE].
        if (event.type === 'error') {
          const failure = hostedErrorDetails(event.data);
          throw new ChatError(0, failure.message, failure.code);
        }
        if (event.type === 'tool_status') {
          callbacks.onToolStatus?.(normalizeToolStatus(event.data));
          continue;
        }
        if (event.type === 'request_id') {
          const requestID = extractRequestID(event.data);
          if (requestID) callbacks.onRequestId?.(requestID);
          continue;
        }
        if (event.type === 'moderation') {
          // A revoke frame must interrupt this turn immediately: after the throw, the caller cancels the typewriter queue and clears rendered content,
          // so no model body appears on screen after revoke.
          if (isModerationRevokeEvent(event.data)) {
            throw new ChatError(0, moderationRevokeMessage(event.data), 'content_policy_violation');
          }
          if (isModerationAnswerEvent(event.data)) callbacks.onModerationAnswer?.();
          continue;
        }
        if (event.type === 'citations') {
          const cited = normalizeCitations(event.data);
          if (cited.length) callbacks.onCitations?.(cited);
          continue;
        }
        const { content, reasoning, usage, citations } = extractDeltas(event.data);
        if (content) emitContentDelta(think, content, callbacks);
        if (reasoning) callbacks.onReasoning?.(reasoning);
        if (citations && citations.length) callbacks.onCitations?.(citations);
        if (usage) callbacks.onUsage?.(usage);
      }
    }
    throw new ChatError(0, '对话流意外中断，请重试');
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

/** Non-streaming chat result: full body plus optional reasoning, optional usage, and optional citation sources */
export interface ChatCompletionResult {
  content: string;
  reasoning: string;
  requestId?: string;
  moderationAnswer?: boolean;
  usage?: TokenUsage;
  citations?: Citation[];
}

/**
 * Start one non-streaming chat and return the full result at once (stream=false).
 *
 * @param params Chat parameters (this function forces stream=false)
 * @param secret Plaintext API Key (Bearer), passed in memory only and not written to disk
 * @param signal AbortController.signal, used for Stop generating
 * @throws ChatError when upstream returns non-2xx
 * @throws DOMException(AbortError) when the caller aborts
 */
export async function requestChat(
  params: ChatCompletionParams,
  secret: string,
  signal?: AbortSignal,
  clientRequestID?: string,
  runtimeContext?: PlaygroundRuntimeContext,
): Promise<ChatCompletionResult> {
  const res = await fetch(buildUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(getToken() ? { 'X-Map-Portal-Token': `Bearer ${getToken()}` } : {}),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Map-Playground-Experience': 'language',
      ...(clientRequestID ? { 'X-Request-Id': clientRequestID } : {}),
      ...playgroundRuntimeContextHeaders(runtimeContext),
    },
    body: JSON.stringify({ ...params, stream: false }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ChatError(res.status, mapErrorMessage(res.status, text), extractUpstreamCode(text));
  }

  const data = (await res.json().catch(() => null)) as unknown;
  const result = extractCompletion(data);
  const requestID = platformRequestID(res.headers.get('X-Request-Id'));
  if (requestID) result.requestId = requestID;
  if (isModerationAnswerResponse(res)) result.moderationAnswer = true;
  return result;
}

/** Convert Playground runtime context into restricted request headers for a direct L2 call. */
function playgroundRuntimeContextHeaders(
  runtimeContext?: PlaygroundRuntimeContext,
  options?: { includeLocation?: boolean },
): Record<string, string> {
  if (!runtimeContext) return {};
  return {
    ...(runtimeContext.timezone ? { 'X-Map-Playground-Timezone': runtimeContext.timezone } : {}),
    'X-Map-Playground-Locale': runtimeContext.locale,
    'X-Map-Playground-UTC-Offset-Minutes': String(runtimeContext.utc_offset_minutes),
    ...(options?.includeLocation && runtimeContext.location
      ? { 'X-Map-Playground-Location': runtimeContext.location }
      : {}),
  };
}

/** Read platform metadata from L2 response headers. */
function emitResponseMetadata(res: Response, callbacks: StreamCallbacks): void {
  const requestID = platformRequestID(res.headers.get('X-Request-Id'));
  if (requestID) callbacks.onRequestId?.(requestID);
  if (isModerationAnswerResponse(res)) callbacks.onModerationAnswer?.();
}

/** Read the final model-call request_id from the hosted web search SSE event. */
function extractRequestID(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const value = (data as Record<string, unknown>).request_id;
  return typeof value === 'string' ? platformRequestID(value) : '';
}

function isModerationAnswerResponse(res: Response): boolean {
  return res.headers.get('X-Map-Moderation-Action')?.trim().toLowerCase() === 'answer';
}

function isModerationAnswerEvent(data: unknown): boolean {
  return Boolean(
    data && typeof data === 'object' && (data as Record<string, unknown>).action === 'answer',
  );
}

/**
 * Detect an output content-safety-review revoke frame.
 *
 * Background: L2 reviews streaming output in chunks and forwards a chunk once it passes, to keep streaming responsive; if the final full-text review finds a violation,
 * it sends `event: moderation` + `action: revoke`, telling the client to revoke everything already rendered for this turn.
 */
function isModerationRevokeEvent(data: unknown): boolean {
  return Boolean(
    data && typeof data === 'object' && (data as Record<string, unknown>).action === 'revoke',
  );
}

/** User-visible copy for a revoke frame; fall back to the generic notice when absent. */
function moderationRevokeMessage(data: unknown): string {
  const fallback = '内容不合规，本次回答已撤回';
  if (!data || typeof data !== 'object') return fallback;
  return pickString(data as Record<string, unknown>, 'message') || fallback;
}

/** Accept only the request_id format generated by the MAP platform, so an unknown event or a client id is not written into the conversation. */
function platformRequestID(value: string | null): string {
  const requestID = value?.trim() ?? '';
  return requestID.startsWith('req_') ? requestID : '';
}

/** Safely read a string field from an unknown value */
function pickString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === 'string' ? v : '';
}

function hostedErrorDetails(data: unknown): { message: string; code?: string } {
  const fallback = '联网搜索请求失败，请稍后重试';
  if (!data || typeof data !== 'object') return { message: fallback };
  const root = data as Record<string, unknown>;
  const nested =
    root.error && typeof root.error === 'object' ? (root.error as Record<string, unknown>) : root;
  const message =
    typeof nested.message === 'string' && nested.message.trim() ? nested.message : fallback;
  const code = typeof nested.code === 'string' && nested.code.trim() ? nested.code : undefined;
  return { message, code };
}

function streamErrorDetails(data: unknown): { message: string; code?: string } {
  const fallback = '对话流未通过安全审核，请重试';
  if (!data || typeof data !== 'object') return { message: fallback };
  const root = data as Record<string, unknown>;
  const nested =
    root.error && typeof root.error === 'object' ? (root.error as Record<string, unknown>) : root;
  const message =
    typeof nested.message === 'string' && nested.message.trim() ? nested.message : fallback;
  const code = typeof nested.code === 'string' && nested.code.trim() ? nested.code : undefined;
  return { message, code };
}

function isTerminalUsageChunk(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const chunk = data as Record<string, unknown>;
  if (!chunk.usage || typeof chunk.usage !== 'object') return false;
  const choices = chunk.choices;
  if (!Array.isArray(choices)) return false;
  if (choices.length === 0) return true;
  return choices.every((choice) => {
    if (!choice || typeof choice !== 'object') return false;
    const finishReason = (choice as Record<string, unknown>).finish_reason;
    return typeof finishReason === 'string' && finishReason.trim() !== '';
  });
}

function normalizeToolStatus(data: unknown): ToolStatusEvent {
  if (!data || typeof data !== 'object') return {};
  const obj = data as Record<string, unknown>;
  return {
    event_id: pickString(obj, 'event_id') || undefined,
    step: typeof obj.step === 'number' ? obj.step : undefined,
    tool: pickString(obj, 'tool') || undefined,
    status: pickString(obj, 'status') || undefined,
    queries: Array.isArray(obj.queries)
      ? obj.queries.filter((v): v is string => typeof v === 'string')
      : undefined,
    urls: Array.isArray(obj.urls)
      ? obj.urls.filter((v): v is string => typeof v === 'string')
      : undefined,
    result_count: typeof obj.result_count === 'number' ? obj.result_count : undefined,
    duration_ms: typeof obj.duration_ms === 'number' ? obj.duration_ms : undefined,
    message: pickString(obj, 'message') || undefined,
  };
}

/** Decide whether the response is SSE; an L3 envelope must not enter streaming parse even on HTTP 200. */
function isEventStreamResponse(res: Response): boolean {
  return res.headers.get('Content-Type')?.toLowerCase().includes('text/event-stream') ?? false;
}

/**
 * Extract body, reasoning, and usage from a non-streaming OpenAI-compatible response.
 * The body is `choices[0].message.content`; reasoning falls back through reasoning_content → reasoning → thinking.
 */
function extractCompletion(data: unknown): ChatCompletionResult {
  const out: ChatCompletionResult = { content: '', reasoning: '' };
  if (!data || typeof data !== 'object') return out;
  const obj = data as Record<string, unknown>;

  const choices = obj.choices;
  if (
    Array.isArray(choices) &&
    choices.length > 0 &&
    choices[0] &&
    typeof choices[0] === 'object'
  ) {
    const message = (choices[0] as Record<string, unknown>).message;
    if (message && typeof message === 'object') {
      const m = message as Record<string, unknown>;
      const nativeReasoning =
        pickString(m, 'reasoning_content') ||
        pickString(m, 'reasoning') ||
        pickString(m, 'thinking');
      // The body may inline <think>…</think> (see sse.ts): split it once and merge reasoning into the reasoning channel.
      const think = createThinkSplitState();
      const split = splitThinkDelta(think, pickString(m, 'content'));
      const tail = flushThinkDelta(think);
      out.content = split.content + tail.content;
      out.reasoning = nativeReasoning + split.reasoning + tail.reasoning;
      const citations = normalizeCitations(m.annotations ?? m.citations);
      if (citations.length) out.citations = citations;
    }
  }

  const u = obj.usage;
  if (u && typeof u === 'object') {
    const uo = u as Record<string, unknown>;
    const total = typeof uo.total_tokens === 'number' ? uo.total_tokens : 0;
    if (total > 0) {
      out.usage = {
        prompt_tokens: typeof uo.prompt_tokens === 'number' ? uo.prompt_tokens : 0,
        completion_tokens: typeof uo.completion_tokens === 'number' ? uo.completion_tokens : 0,
        total_tokens: total,
      };
    }
  }

  return out;
}

/** Map an upstream status code and raw text to a readable Chinese error */
function mapErrorMessage(status: number, raw: string): string {
  const detail = extractUpstreamMessage(raw);
  if (status === 401) return detail || '密钥无效或已过期，请重新选择 API Key';
  if (status === 402) return detail || '账号未开通计费或额度不足，请充值/分配额度后再试';
  if (status === 403) return detail || '账号已被禁用或无权调用该模型';
  if (status === 404) return detail || '对话服务地址不可达（请检查 chat 代理链路）';
  if (status === 429) return detail || '请求过于频繁，已触发限流，请稍后再试';
  if (status >= 500) return detail || '上游服务异常，请稍后再试';
  return detail || `请求失败（HTTP ${status}）`;
}

/** Try to read a readable message from an OpenAI-style error body `{error:{message}}` */
function extractUpstreamMessage(raw: string): string {
  if (!raw) return '';
  try {
    const obj = JSON.parse(raw) as { error?: { message?: string }; message?: string };
    return obj.error?.message || obj.message || '';
  } catch {
    const text = raw.trim();
    return /^<!?(?:doctype|html)\b/i.test(text) ? '' : text.slice(0, 200);
  }
}

/** Extract an OpenAI-style error code so a content-safety block can be rendered as a normal assistant reply. */
function extractUpstreamCode(raw: string): string | undefined {
  if (!raw) return undefined;
  try {
    const obj = JSON.parse(raw) as { error?: { code?: string } };
    return obj.error?.code;
  } catch {
    return undefined;
  }
}

/** Description of a tool available in Playground. */
export interface PlaygroundTool {
  name: string;
  description: string;
  default_on: boolean;
  kind: 'search' | 'reader' | 'generic';
}

/** Fetch the Playground tool list (built-in tools plus MCP generic tools). */
export async function getPlaygroundTools(): Promise<PlaygroundTool[]> {
  const token = getToken();
  const res = await fetch('/api/playground/tools', {
    headers: {
      Authorization: token ? `Bearer ${token}` : '',
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch playground tools: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { tools: PlaygroundTool[] };
  return data.tools ?? [];
}
