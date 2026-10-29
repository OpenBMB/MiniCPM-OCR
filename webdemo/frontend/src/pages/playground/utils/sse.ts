/**
 * Pure functions that parse SSE (Server-Sent Events) lines.
 *
 * Purpose: cut the text buffer accumulated by a streaming fetch into complete SSE lines, and from an OpenAI-compatible chunk
 * extract the body increment, the reasoning increment, and the tail usage. No side effects, no fetch dependency, so they are easy to unit test.
 */

import type { Citation, TokenUsage } from '@/api/map/chat';

/** Parse result of one SSE line */
export interface SseEvent {
  /**
   * chunk = a data frame carrying data JSON; done = the `[DONE]` terminal frame;
   * tool_status = tool progress; citations = citation sources; request_id = the final model-call ID;
   * moderation = a moderation safety answer; error = an in-band error frame.
   */
  type: 'chunk' | 'done' | 'tool_status' | 'citations' | 'request_id' | 'moderation' | 'error';
  /** Parsed JSON when type=chunk (undefined when parsing failed) */
  data?: unknown;
}

/** A complete SSE frame (separated by a blank line) */
export interface SseFrame {
  event?: string;
  data: string;
}

/** Increment extracted from one OpenAI chunk */
export interface ChunkDeltas {
  /** Body increment */
  content: string;
  /** Reasoning increment */
  reasoning: string;
  /** Web-search citation sources carried by this frame (url_citation annotations, may be empty) */
  citations?: Citation[];
  /** Tail usage (present only on the last frame) */
  usage?: TokenUsage;
}

/**
 * Cut the accumulated buffer into complete lines plus a leftover unfinished fragment, split on newlines.
 *
 * @param buffer decoded text accumulated by fetch
 * @returns lines that are already complete (without the newline); rest is the trailing fragment that has not seen a newline yet, kept to join next time
 */
export function splitSseLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split('\n');
  // The last segment may be an incomplete line; keep it until next time
  const rest = parts.pop() ?? '';
  const lines = parts.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  return { lines, rest };
}

/**
 * Split the accumulated buffer into SSE frames (a blank line means one complete event).
 * @param buffer decoded text accumulated by fetch
 * @returns complete frames; rest is the unfinished fragment at the end
 */
export function splitSseFrames(buffer: string): { frames: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n\n');
  const rest = parts.pop() ?? '';
  return { frames: parts, rest };
}

/** Map an SSE frame's event field to an internal event type; an undeclared or unknown event is always treated as a default OpenAI chunk. */
function frameEventType(event: string): Exclude<SseEvent['type'], 'done'> {
  if (event === 'tool_status') return 'tool_status';
  if (event === 'citations') return 'citations';
  if (event === 'request_id') return 'request_id';
  if (event === 'moderation') return 'moderation';
  if (event === 'error') return 'error';
  return 'chunk';
}

/**
 * Parse a complete SSE frame, supporting an event field and multi-line data.
 * @param frame complete frame text without the trailing blank line
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
 * Parse one SSE line.
 *
 * Only data lines with a `data:` prefix are handled; comment lines (starting with `:`, often used as heartbeats), blank lines, and other field lines return null.
 *
 * @param line one line of text (no newline)
 * @returns a structured event, or null (a line that should be ignored)
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
    // Incomplete or illegal JSON: ignore this frame so the whole stream is not interrupted
    return { type: 'chunk', data: undefined };
  }
}

/** Safely read a positive integer field from an unknown value; a missing or non-positive value returns 0 (treated as "no number"). */
function pickPositiveInt(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : 0;
}

/** Safely read a string field from an unknown value */
function pickString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === 'string' ? v : '';
}

/** Allow only HTTP(S) sources that can be opened directly in a new browser window. */
function safeCitationURL(value: string): string {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? value : '';
  } catch {
    return '';
  }
}

/**
 * Normalize an OpenAI-compatible annotations array into a citation-source list.
 *
 * Compatible with two shapes: `{type:'url_citation', url_citation:{url,title}}` (official OpenAI),
 * and the flat `{url,title}` some implementations use directly. Return an empty array when it is not an array or has no valid url.
 * If a source number (ref / index) is present, carry it along; it is the only source of the citation-marker number.
 *
 * @param value raw annotations value on delta/message
 * @returns normalized citation sources (only items that contain a url are kept)
 */
export function normalizeCitations(value: unknown): Citation[] {
  if (!Array.isArray(value)) return [];
  const out: Citation[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    // Official shape: the url_citation child object; otherwise fall back to the flat fields
    const src =
      obj.url_citation && typeof obj.url_citation === 'object'
        ? (obj.url_citation as Record<string, unknown>)
        : obj;
    const url = safeCitationURL(pickString(src, 'url'));
    if (!url) continue;
    const title = pickString(src, 'title');
    const snippet =
      pickString(src, 'snippet') || pickString(src, 'excerpt') || pickString(src, 'text');
    // The two exits name the same number differently: the experience center's citation event calls it ref,
    // and the public API's url_citation calls it index (aligned with OpenAI's annotation shape).
    // The number may hang on the url_citation child object or on the flat item; both places have to be checked.
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
 * Extract the body and reasoning increments and usage from an OpenAI-compatible chunk.
 *
 * Reasoning fields are named differently per model; take the first non-empty value in the order `reasoning_content → reasoning → thinking`.
 * usage appears only on the tail chunk (the backend already forces stream_options.include_usage).
 *
 * @param chunk chunk that has already been JSON.parse'd
 * @returns this frame's body and reasoning increments and optional usage
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
        // A web-search citation may hang on delta.annotations (official) or delta.citations (some implementations)
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
