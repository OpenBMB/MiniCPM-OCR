/**
 * SSE（Server-Sent Events）行解析纯函数。
 *
 * 用途：把流式 fetch 累积的文本 buffer 切成完整 SSE 行，并从 OpenAI 兼容 chunk 中
 * 抽取正文增量、思考增量与尾块 usage。无副作用、不依赖 fetch，便于单测。
 */

import type { Citation, TokenUsage } from '@/api/map/chat';

/** 单行 SSE 解析结果 */
export interface SseEvent {
  /**
   * chunk = 携带 data JSON 的数据帧；done = `[DONE]` 终止帧；
   * tool_status = 工具进度；citations = 引用来源；request_id = 最终模型调用 ID；
   * moderation = 审核安全回答；error = 带内错误帧。
   */
  type: 'chunk' | 'done' | 'tool_status' | 'citations' | 'request_id' | 'moderation' | 'error';
  /** type=chunk 时的已解析 JSON（解析失败为 undefined） */
  data?: unknown;
}

/** 完整 SSE frame（以空行分隔） */
export interface SseFrame {
  event?: string;
  data: string;
}

/** 从单个 OpenAI chunk 抽出的增量 */
export interface ChunkDeltas {
  /** 正文增量 */
  content: string;
  /** 思考增量 */
  reasoning: string;
  /** 本帧携带的联网引用来源（url_citation annotations，可能为空） */
  citations?: Citation[];
  /** 尾块 usage（仅最后一帧带） */
  usage?: TokenUsage;
}

/**
 * 把累积 buffer 按换行切成完整行 + 残留未完成片段。
 *
 * @param buffer fetch 累积的解码文本
 * @returns lines 已完整的行（不含换行符）；rest 末尾未遇到换行的残片，留待下次拼接
 */
export function splitSseLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split('\n');
  // 最后一段可能是不完整行，保留到下次
  const rest = parts.pop() ?? '';
  const lines = parts.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  return { lines, rest };
}

/**
 * 把累积 buffer 按 SSE frame 切分（空行表示一个完整事件）。
 * @param buffer fetch 累积的解码文本
 * @returns frames 完整 frame；rest 末尾未完成片段
 */
export function splitSseFrames(buffer: string): { frames: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n\n');
  const rest = parts.pop() ?? '';
  return { frames: parts, rest };
}

/** 把 SSE frame 的 event 字段映射为内部事件类型；未声明或未知 event 一律按默认 OpenAI chunk 处理。 */
function frameEventType(event: string): Exclude<SseEvent['type'], 'done'> {
  if (event === 'tool_status') return 'tool_status';
  if (event === 'citations') return 'citations';
  if (event === 'request_id') return 'request_id';
  if (event === 'moderation') return 'moderation';
  if (event === 'error') return 'error';
  return 'chunk';
}

/**
 * 解析完整 SSE frame，支持 event 字段和多行 data。
 * @param frame 不含结尾空行的完整 frame 文本
 */
export function parseSseFrame(frame: string): SseEvent | null {
  let event = '';
  const dataLines: string[] = [];
  for (const rawLine of frame.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trimStart());
  }
  if (dataLines.length === 0) return null;
  const data = dataLines.join('\n').trim();
  if (data === '[DONE]') return { type: 'done' };
  const type = frameEventType(event);
  try {
    return { type, data: JSON.parse(data) };
  } catch {
    return { type, data: undefined };
  }
}

/**
 * 解析单行 SSE。
 *
 * 仅处理 `data:` 前缀的数据行；注释行（`:` 开头，常用于心跳）、空行、其它字段行返回 null。
 *
 * @param line 单行文本（无换行符）
 * @returns 结构化事件，或 null（应忽略的行）
 */
export function parseSseLine(line: string): SseEvent | null {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith('data:')) return null;
  const data = trimmed.slice('data:'.length).trim();
  if (data === '') return null;
  if (data === '[DONE]') return { type: 'done' };
  try {
    return { type: 'chunk', data: JSON.parse(data) };
  } catch {
    // 不完整/非法 JSON：忽略此帧，避免打断整条流
    return { type: 'chunk', data: undefined };
  }
}

/** 从未知值安全取正整数字段；缺省或非正数返回 0（视为「没有编号」）。 */
function pickPositiveInt(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : 0;
}

/** 从未知值安全取字符串字段 */
function pickString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === 'string' ? v : '';
}

/** 仅允许可直接在浏览器新窗口打开的 HTTP(S) 来源。 */
function safeCitationURL(value: string): string {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? value : '';
  } catch {
    return '';
  }
}

/**
 * 把 OpenAI 兼容的 annotations 数组归一化为引用来源列表。
 *
 * 兼容两种形态：`{type:'url_citation', url_citation:{url,title}}`（OpenAI 官方），
 * 以及部分实现直接 `{url,title}` 的扁平形态。非数组或无有效 url 时返回空数组。
 * 来源编号（ref / index）若有则一并带出，它是角标数字的唯一来源。
 *
 * @param value delta/message 上的 annotations 原始值
 * @returns 归一化后的引用来源（仅保留含 url 的项）
 */
export function normalizeCitations(value: unknown): Citation[] {
  if (!Array.isArray(value)) return [];
  const out: Citation[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    // 官方形态：url_citation 子对象；否则退回扁平字段
    const src =
      obj.url_citation && typeof obj.url_citation === 'object'
        ? (obj.url_citation as Record<string, unknown>)
        : obj;
    const url = safeCitationURL(pickString(src, 'url'));
    if (!url) continue;
    const title = pickString(src, 'title');
    const snippet =
      pickString(src, 'snippet') || pickString(src, 'excerpt') || pickString(src, 'text');
    // 两个出口对同一个编号的字段名不同：体验中心的 citation 事件叫 ref，
    // 公开 API 的 url_citation 叫 index（对齐 OpenAI 的 annotation 形状）。
    // 编号可能挂在 url_citation 子对象上，也可能挂在扁平项上，两处都要看。
    const ref =
      pickPositiveInt(src, 'ref') ||
      pickPositiveInt(src, 'index') ||
      pickPositiveInt(obj, 'ref') ||
      pickPositiveInt(obj, 'index');
    out.push({
      ...(ref ? { ref } : {}),
      url,
      ...(title ? { title } : {}),
      ...(snippet ? { snippet } : {}),
    });
  }
  return out;
}

/**
 * 从 OpenAI 兼容 chunk 抽取正文/思考增量与 usage。
 *
 * 思考字段不同模型命名不一，按 `reasoning_content → reasoning → thinking` 顺序兜底取首个非空。
 * usage 仅在尾块出现（后端已强制注入 stream_options.include_usage）。
 *
 * @param chunk 已 JSON.parse 的 chunk
 * @returns 本帧的正文/思考增量与可选 usage
 */
export function extractDeltas(chunk: unknown): ChunkDeltas {
  const empty: ChunkDeltas = { content: '', reasoning: '' };
  if (!chunk || typeof chunk !== 'object') return empty;
  const obj = chunk as Record<string, unknown>;

  let content = '';
  let reasoning = '';
  let citations: Citation[] = [];
  const choices = obj.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0];
    if (first && typeof first === 'object') {
      const delta = (first as Record<string, unknown>).delta;
      if (delta && typeof delta === 'object') {
        const d = delta as Record<string, unknown>;
        content = pickString(d, 'content');
        reasoning =
          pickString(d, 'reasoning_content') ||
          pickString(d, 'reasoning') ||
          pickString(d, 'thinking');
        // 联网引用可能挂在 delta.annotations（官方）或 delta.citations（部分实现）
        citations = normalizeCitations(d.annotations ?? d.citations);
      }
    }
  }

  let usage: TokenUsage | undefined;
  const u = obj.usage;
  if (u && typeof u === 'object') {
    const uo = u as Record<string, unknown>;
    const total = typeof uo.total_tokens === 'number' ? uo.total_tokens : 0;
    if (total > 0) {
      usage = {
        prompt_tokens: typeof uo.prompt_tokens === 'number' ? uo.prompt_tokens : 0,
        completion_tokens: typeof uo.completion_tokens === 'number' ? uo.completion_tokens : 0,
        total_tokens: total,
      };
    }
  }

  return { content, reasoning, usage, citations };
}

export {
  createThinkSplitState,
  flushThinkDelta,
  normalizeAssistantReply,
  splitInlineThinkText,
  splitThinkDelta,
  type ThinkSplitState,
} from './thinkSplit';
