/**
 * MAP 体验中心（Playground）的流式对话 API。
 *
 * 用途：直连 L2 的 OpenAI 兼容 `/v1/chat/completions`（SSE 流式），以用户明文 API Key 作
 * `Bearer` 鉴权。**不复用** `mapRequest`：后者解 L3 统一信封并抛 BizError，不适合 SSE 原始流。
 *
 * 安全：secret（明文 lis_sk_xxx）仅由调用方内存传入，本模块不持久化、不打印。
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
 * chat 端点基址：部署时优先使用 `VITE_CHAT_BASE_URL` 按环境注入。
 * 该值缺失时按 `VITE_AUTH_PROFILE` 回退：GCP 使用 `https://api.modelbest.ai`，
 * legacy 使用 `https://api.modelbest.cn`，避免两套云环境域名交叉。
 * 注意 `/api` 是 L3 控制面前缀（无 `/v1/chat/completions`，直连会 405），对话必须走 L2。
 */
const configuredChatAPIBase = import.meta.env.VITE_CHAT_BASE_URL?.trim();
export const CHAT_API_BASE =
  configuredChatAPIBase ||
  (import.meta.env.VITE_AUTH_PROFILE === 'gcp'
    ? 'https://api.modelbest.ai'
    : 'https://api.modelbest.cn');

/** token 用量 */
export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/**
 * OpenAI 兼容的多模态 content 分段。媒体类优先使用对象存储 URL，兼容保留 data URL/file_data。
 * - image_url / video_url：URL 形态（Qwen-VL 等 OpenAI 兼容视觉模型用 video_url 承载视频）
 * - input_audio：OpenAI Chat Completions 音频入参（data 为**去前缀**的裸 base64 + format）
 * - file：OpenAI 文件入参（file_data 为完整 data URL，filename 供上游识别类型）
 */
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'video_url'; video_url: { url: string } }
  | { type: 'input_audio'; input_audio: { data: string; format: string } }
  | { type: 'file'; file: { filename: string; file_data?: string; file_url?: string } };

/** 发往后端的一条对话消息；content 为字符串或多模态分段数组 */
export interface ChatRequestMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatContentPart[];
}

/**
 * 对话补全参数。除 model/messages 外均为可选，后端原样透传到 LIS。
 * 用索引签名预留 tools / web_search / response_format 等未显式声明字段。
 */
export interface ChatCompletionParams {
  model: string;
  messages: ChatRequestMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  reasoning_effort?: 'low' | 'medium' | 'high';
  thinking?: { type: 'enabled' | 'disabled' } | Record<string, unknown>;
  /** MiniCPM/LIS 思考开关：chat_template_kwargs.enable_thinking（默认 true） */
  chat_template_kwargs?: { enable_thinking?: boolean } & Record<string, unknown>;
  /** MiniCPM-V-4.7 图片压缩参数；仅用户显式选择时发送。 */
  mm_processor_kwargs?: { downsample_mode?: '4x' | '16x' } & Record<string, unknown>;
  /** 保留兼容字段类型；Playground hosted web search 不再由前端下发该字段 */
  web_search_options?: Record<string, unknown>;
  [key: string]: unknown;
}

/** 联网搜索引用来源（归一化后的 url_citation） */
export interface Citation {
  /** 后端分配的全局来源编号（1 起）；见 pages/playground/types.ts 的同名字段。 */
  ref?: number;
  url: string;
  title?: string;
  snippet?: string;
}

/** Playground 请求携带的浏览器运行时上下文提示。 */
export interface PlaygroundRuntimeContext {
  timezone?: string;
  locale: 'zh-CN' | 'en-US';
  utc_offset_minutes: number;
  /** 用户手动设置的当前位置（如"北京市"），用于 datetime 工具回答地点相关问题。 */
  location?: string;
}

/** 流式回调集合 */
export interface StreamCallbacks {
  /** 正文增量（choices[].delta.content） */
  onContent: (delta: string) => void;
  /** 思考增量（reasoning_content / reasoning / thinking） */
  onReasoning?: (delta: string) => void;
  /** 联网搜索引用来源（url_citation annotations，流式下可能多次到达，取并集） */
  onCitations?: (citations: Citation[]) => void;
  /** hosted web search 工具状态事件 */
  onToolStatus?: (status: ToolStatusEvent) => void;
  /** 当前回答对应的平台 L2 请求 ID */
  onRequestId?: (requestId: string) => void;
  /** 当前回答由输入安审服务代答，当前问答轮不得再进入后续模型上下文。 */
  onModerationAnswer?: () => void;
  /** 尾块 usage（后端已强制注入 include_usage） */
  onUsage?: (usage: TokenUsage) => void;
  /** 上游结束原因，供文档识别区分完整结果与输出限长。 */
  onFinishReason?: (reason: string) => void;
  /** 正常收尾（收到 [DONE]） */
  onDone?: () => void;
}

/** hosted web search 工具状态事件 */
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
 * 生成体验中心对话的客户端关联 ID。
 *
 * 用途：直连调用经 `X-Request-Id` 传入 L2，联网调用传给 L3 记录最终调用映射；
 * 两者都只作为 `client_request_id`。平台仍自行生成并返回权威的 `req_xxx`。
 */
export function createPlaygroundClientRequestID(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `map_playground_${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
}

/** 携带 HTTP 状态码的对话错误，便于上层区分 401/404/429 */
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

/** 读取当前登录 token（用于走 /api 同源代理时附带门户登录态，不影响 L2 的 Bearer 鉴权语义） */
function buildUrl(): string {
  return `${CHAT_API_BASE}/v1/chat/completions`;
}

/**
 * 把正文增量经 `<think>` 拆分后分发：think 段落改路由到思考通道，正文保持干净。
 * 见 sse.ts：部分模型（联网路径带 tools 时上游不再分离 reasoning）把思考内联在 content。
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

/** 流结束时清空 `<think>` 拆分残留，兜底分发，避免半标签或未闭合 think 吞字。 */
function drainThink(state: ThinkSplitState, callbacks: StreamCallbacks): void {
  const rest = flushThinkDelta(state);
  if (rest.content) callbacks.onContent(rest.content);
  if (rest.reasoning) callbacks.onReasoning?.(rest.reasoning);
}

/**
 * 发起一次流式对话，逐块回调。
 *
 * @param params 对话参数（本函数内部强制置 stream=true）
 * @param secret 明文 API Key（Bearer），仅内存传入，不落盘
 * @param callbacks 流式回调
 * @param signal AbortController.signal，用于「停止生成」
 * @throws ChatError 当上游返回非 2xx（含 401 key 失效 / 404 链路问题 / 429 限流）
 * @throws DOMException(AbortError) 当调用方主动中断——上层应视为正常停止，不报错
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
          // 撤回帧必须立即中断本轮：抛出后上层会取消打字机队列并清空已渲染内容，
          // 保证 revoke 之后不再有任何模型正文上屏。
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
    // 中断/异常时取消底层读取，避免连接泄漏
    void reader.cancel().catch(() => undefined);
  }
}

/** 透传上游真实结束原因，不改变既有聊天完成语义。 */
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
 * 发起一次 Playground hosted web search 流式对话。
 * @param params 对话参数（本函数内部强制置 stream=true）
 * @param apiKeyId 服务端可校验的 API Key ID；为空时后端按默认规则选择
 * @param callbacks 流式回调
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
      // 与直连链路一致：运行时上下文走受限请求头，不暴露在托管请求体里。
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
        // 带内错误帧：BFF 在 SSE 已开始后无法改 HTTP 状态码，用 event: error 承载。
        // 抛出交由上层 catch 落错误态，避免被当作普通状态在 [DONE] 后被清除。
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
          // 撤回帧必须立即中断本轮：抛出后上层会取消打字机队列并清空已渲染内容，
          // 保证 revoke 之后不再有任何模型正文上屏。
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

/** 非流式对话结果：完整正文 + 可选思考 + 可选 usage + 可选引用来源 */
export interface ChatCompletionResult {
  content: string;
  reasoning: string;
  requestId?: string;
  moderationAnswer?: boolean;
  usage?: TokenUsage;
  citations?: Citation[];
}

/**
 * 发起一次非流式对话，一次性返回完整结果（stream=false）。
 *
 * @param params 对话参数（本函数内部强制置 stream=false）
 * @param secret 明文 API Key（Bearer），仅内存传入，不落盘
 * @param signal AbortController.signal，用于「停止生成」
 * @throws ChatError 当上游返回非 2xx
 * @throws DOMException(AbortError) 当调用方主动中断
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

/** 将 Playground 运行时上下文转换为直连 L2 的受限请求头。 */
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

/** 从 L2 响应头读取平台元数据。 */
function emitResponseMetadata(res: Response, callbacks: StreamCallbacks): void {
  const requestID = platformRequestID(res.headers.get('X-Request-Id'));
  if (requestID) callbacks.onRequestId?.(requestID);
  if (isModerationAnswerResponse(res)) callbacks.onModerationAnswer?.();
}

/** 从 hosted web search 的专用 SSE 事件读取最终模型调用 request_id。 */
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
 * 判定输出安审撤回帧。
 *
 * 背景：L2 对流式输出按分片审核，分片过审即下发以保证流式观感；若全文终审判违规，
 * 会补发 `event: moderation` + `action: revoke`，要求客户端撤回本轮已渲染的全部内容。
 */
function isModerationRevokeEvent(data: unknown): boolean {
  return Boolean(
    data && typeof data === 'object' && (data as Record<string, unknown>).action === 'revoke',
  );
}

/** 撤回帧的用户可见文案，缺省回退通用提示。 */
function moderationRevokeMessage(data: unknown): string {
  const fallback = '内容不合规，本次回答已撤回';
  if (!data || typeof data !== 'object') return fallback;
  return pickString(data as Record<string, unknown>, 'message') || fallback;
}

/** 仅接受 MAP 平台生成的 request_id 格式，避免把未知事件或客户端标识写入会话。 */
function platformRequestID(value: string | null): string {
  const requestID = value?.trim() ?? '';
  return requestID.startsWith('req_') ? requestID : '';
}

/** 从未知值安全取字符串字段 */
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

/** 判断响应是否为 SSE；L3 统一信封即使 HTTP 200 也不能进入流式解析。 */
function isEventStreamResponse(res: Response): boolean {
  return res.headers.get('Content-Type')?.toLowerCase().includes('text/event-stream') ?? false;
}

/**
 * 从非流式 OpenAI 兼容响应抽取正文/思考/usage。
 * 正文取 `choices[0].message.content`；思考按 reasoning_content → reasoning → thinking 兜底。
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
      // 正文可能内联 <think>…</think>（见 sse.ts）：一次性拆出，思考并入 reasoning 通道。
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

/** 把上游状态码与原始文本映射为可读中文错误 */
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

/** 尝试从 OpenAI 风格错误体 `{error:{message}}` 取出可读信息 */
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

/** 提取 OpenAI 风格错误码，用于将内容安全拦截渲染为普通助手回复。 */
function extractUpstreamCode(raw: string): string | undefined {
  if (!raw) return undefined;
  try {
    const obj = JSON.parse(raw) as { error?: { code?: string } };
    return obj.error?.code;
  } catch {
    return undefined;
  }
}

/** Playground 可用工具描述。 */
export interface PlaygroundTool {
  name: string;
  description: string;
  default_on: boolean;
  kind: 'search' | 'reader' | 'generic';
}

/** 获取 Playground 可用工具列表（含内置 + MCP generic 工具）。 */
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
