/**
 * Streaming split of inline think tags, and one-shot normalization.
 *
 * Purpose: pull inline reasoning paragraphs in model output (tags such as think / redacted_thinking / thinking)
 * out of the body and route them to the reasoning channel; reused by SSE streaming increments and as a fallback in the message display layer.
 */

/** Supported think open/close tag pairs (ordered by how common they are; streaming match takes the earliest open tag in the buffer) */
const THINK_TAG_PAIRS: ReadonlyArray<{ open: string; close: string }> = [
  { open: '<think>', close: '</think>' },
  { open: '<redacted_thinking>', close: '</redacted_thinking>' },
  { open: '<thinking>', close: '</thinking>' },
];

/**
 * An upstream agent occasionally mixes an internal execution trace into assistant text.
 *
 * This content is not an answer for the user, and must not enter history context; structured tool state is already carried
 * separately by tool_status/citations, so only an execution log that can be recognized clearly is filtered here.
 */
const INTERNAL_EXECUTION_LINE_PATTERNS: ReadonlyArray<RegExp> = [
  /^\s*(?:已|正在|刚刚)?查看\s*\d+\s*张(?:图像|图片|截图)/i,
  /^\s*(?:已|正在)?读取(?:了)?(?:文件)?(?:\s+|$)/i,
  /^\s*(?:已|正在)?打开(?:了)?(?:文件)?(?:\s+|$)/i,
  /^\s*(?:已|正在)?在.+中搜索\b/i,
  /^\s*(?:调用|执行|使用|运行)(?:了)?\s*(?:工具|函数|命令|web_search|browser)\b/i,
  /^\s*(?:tool call|function call|read file|view image|open file|searching|searched)\b/i,
];

/** Internal development-process notes that are removed only after an execution trace is detected, so a normal answer is not damaged by mistake. */
const INTERNAL_PROCESS_LINE_PATTERNS: ReadonlyArray<RegExp> = [
  /^\s*(?:我会|接下来我会|现在我会).*(?:工具调用|工具状态|执行日志|过程轨道|重新收成|检查当前实现|补.*测试|运行.*测试|修改.*代码)/i,
];

/** Streaming split state for inline think */
export interface ThinkSplitState {
  /** Whether the parser is currently inside a think block */
  inThink: boolean;
  /** Close tag to match while inside a block; null while outside */
  closeTag: string | null;
  /** A trailing fragment that may be half a tag, kept to decide again after the next chunk is joined */
  pending: string;
}

/** Create think-split state for a new stream */
export function createThinkSplitState(): ThinkSplitState {
  return { inThink: false, closeTag: null, pending: '' };
}

/** Longest length (1..tag.length-1) where the end of s equals a prefix of tag, used to keep half a tag across chunks */
function trailingTagPrefixLen(s: string, tag: string): number {
  const max = Math.min(s.length, tag.length - 1);
  for (let k = max; k >= 1; k -= 1) {
    if (s.slice(s.length - k) === tag.slice(0, k)) return k;
  }
  return 0;
}

/** Find the earliest open tag in buffer[i..]; return null when there is none */
function findEarliestOpenTag(
  buffer: string,
  from: number,
): { open: string; close: string; index: number } | null {
  let best: { open: string; close: string; index: number } | null = null;
  for (const pair of THINK_TAG_PAIRS) {
    const idx = buffer.indexOf(pair.open, from);
    if (idx < 0) continue;
    if (!best || idx < best.index) best = { ...pair, index: idx };
  }
  return best;
}

/** Outside a block: keep the longest trailing fragment of buffer that may be a prefix of any open or close tag */
function trailingAnyTagPrefixLen(buffer: string, from: number): number {
  let keep = 0;
  for (const pair of THINK_TAG_PAIRS) {
    keep = Math.max(keep, trailingTagPrefixLen(buffer.slice(from), pair.open));
    keep = Math.max(keep, trailingTagPrefixLen(buffer.slice(from), pair.close));
  }
  return keep;
}

/**
 * Split one body increment on think tags into a "body" increment and a "reasoning" increment (stateful, and may cross SSE chunks).
 * @param state split state of this stream (updated in place)
 * @param delta this frame's delta.content increment
 */
export function splitThinkDelta(
  state: ThinkSplitState,
  delta: string,
): { content: string; reasoning: string } {
  let content = '';
  let reasoning = '';
  const buffer = state.pending + delta;
  state.pending = '';
  let i = 0;

  for (;;) {
    if (state.inThink && state.closeTag) {
      const closeTag = state.closeTag;
      const idx = buffer.indexOf(closeTag, i);
      if (idx >= 0) {
        reasoning += buffer.slice(i, idx);
        i = idx + closeTag.length;
        state.inThink = false;
        state.closeTag = null;
        continue;
      }
      const rest = buffer.slice(i);
      const keep = trailingTagPrefixLen(rest, closeTag);
      reasoning += rest.slice(0, rest.length - keep);
      state.pending = rest.slice(rest.length - keep);
      break;
    }

    const hit = findEarliestOpenTag(buffer, i);
    if (hit) {
      content += buffer.slice(i, hit.index);
      i = hit.index + hit.open.length;
      state.inThink = true;
      state.closeTag = hit.close;
      continue;
    }

    const rest = buffer.slice(i);
    const keep = trailingAnyTagPrefixLen(buffer, i);
    content += rest.slice(0, rest.length - keep);
    state.pending = rest.slice(rest.length - keep);
    break;
  }

  return { content, reasoning };
}

/** On stream end, clear pending so a half tag or an unclosed think does not swallow characters */
export function flushThinkDelta(state: ThinkSplitState): { content: string; reasoning: string } {
  const pending = state.pending;
  state.pending = '';
  if (!pending) return { content: '', reasoning: '' };
  return state.inThink ? { content: '', reasoning: pending } : { content: pending, reasoning: '' };
}

/**
 * Split think and body on a complete string in one pass (stateless, a fallback for non-streaming responses and the display layer).
 * @param text full text to split
 */
export function splitInlineThinkText(text: string): { content: string; reasoning: string } {
  const state = createThinkSplitState();
  const split = splitThinkDelta(state, text);
  const tail = flushThinkDelta(state);
  return {
    content: split.content + tail.content,
    reasoning: split.reasoning + tail.reasoning,
  };
}

function matchesAnyPattern(line: string, patterns: ReadonlyArray<RegExp>): boolean {
  return patterns.some((pattern) => pattern.test(line));
}

function hasInternalExecutionTrace(text: string): boolean {
  return text
    .split(/\r?\n/)
    .some((line) => matchesAnyPattern(line, INTERNAL_EXECUTION_LINE_PATTERNS));
}

/**
 * Clean recognizable internal execution logs out of the body.
 *
 * detected is returned for reasoning: once the reasoning field is mixed with an execution trace, the whole segment is no longer shown,
 * so deleting only a few lines does not still leak a file name, a query, or an internal work note.
 */
function stripInternalExecutionTrace(text: string): { text: string; detected: boolean } {
  const detected = hasInternalExecutionTrace(text);
  if (!detected) return { text, detected: false };

  const cleaned = text
    .split(/\r?\n/)
    .filter(
      (line) =>
        !matchesAnyPattern(line, INTERNAL_EXECUTION_LINE_PATTERNS) &&
        !matchesAnyPattern(line, INTERNAL_PROCESS_LINE_PATTERNS),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text: cleaned, detected: true };
}

/**
 * Normalize body and reasoning for assistant display: strip leftover inline think tags from content and reasoning.
 * @param content top-level body
 * @param reasoning existing reasoning field (may be empty)
 */
export function normalizeAssistantReply(
  content: string,
  reasoning?: string,
): { content: string; reasoning: string } {
  const fromContent = splitInlineThinkText(content);
  let fromReasoningField = '';
  if (reasoning) {
    const splitReasoning = splitInlineThinkText(reasoning);
    // When there is no inline tag, split puts the whole text on the content path; here the whole segment should be treated as reasoning text
    fromReasoningField = splitReasoning.reasoning || splitReasoning.content;
  }

  const cleanedContent = stripInternalExecutionTrace(fromContent.content);
  const rawReasoning = [fromContent.reasoning, fromReasoningField].filter(Boolean).join('');
  const cleanedReasoning = stripInternalExecutionTrace(rawReasoning);

  return {
    content: cleanedContent.text,
    // The reasoning area does not show any raw content mixed with an internal execution trace; the search process is carried by the structured status area.
    reasoning: cleanedReasoning.detected ? '' : rawReasoning,
  };
}
