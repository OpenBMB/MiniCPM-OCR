/**
 * 内联 think 标签流式拆分与一次性归一化。
 *
 * 用途：把模型输出里内联思考段落（think / redacted_thinking / thinking 等标签）
 * 从正文中拆出，路由到 reasoning 通道；供 SSE 流式增量与消息展示层兜底复用。
 */

/** 支持的 think 开闭标签对（按常见度排序；流式匹配时取 buffer 内最早出现的开标签） */
const THINK_TAG_PAIRS: ReadonlyArray<{ open: string; close: string }> = [
  { open: '<think>', close: '</think>' },
  { open: '<redacted_thinking>', close: '</redacted_thinking>' },
  { open: '<thinking>', close: '</thinking>' },
];

/**
 * 上游 Agent 偶尔会把内部执行轨迹混入 assistant 文本。
 *
 * 这些内容不是面向用户的回答，也不能进入历史上下文；结构化工具状态已经由
 * tool_status/citations 单独承载，因此这里只过滤明确可识别的执行日志。
 */
const INTERNAL_EXECUTION_LINE_PATTERNS: ReadonlyArray<RegExp> = [
  /^\s*(?:已|正在|刚刚)?查看\s*\d+\s*张(?:图像|图片|截图)/i,
  /^\s*(?:已|正在)?读取(?:了)?(?:文件)?(?:\s+|$)/i,
  /^\s*(?:已|正在)?打开(?:了)?(?:文件)?(?:\s+|$)/i,
  /^\s*(?:已|正在)?在.+中搜索\b/i,
  /^\s*(?:调用|执行|使用|运行)(?:了)?\s*(?:工具|函数|命令|web_search|browser)\b/i,
  /^\s*(?:tool call|function call|read file|view image|open file|searching|searched)\b/i,
];

/** 只有检测到执行轨迹后才移除的内部开发过程说明，避免误伤正常回答。 */
const INTERNAL_PROCESS_LINE_PATTERNS: ReadonlyArray<RegExp> = [
  /^\s*(?:我会|接下来我会|现在我会).*(?:工具调用|工具状态|执行日志|过程轨道|重新收成|检查当前实现|补.*测试|运行.*测试|修改.*代码)/i,
];

/** 内联 think 流式拆分状态 */
export interface ThinkSplitState {
  /** 当前是否处于 think 块内 */
  inThink: boolean;
  /** 块内时应匹配的闭标签；块外为 null */
  closeTag: string | null;
  /** 末尾可能是半个标签的残片，留待下一分片拼接后再判定 */
  pending: string;
}

/** 新建一条流的 think 拆分状态 */
export function createThinkSplitState(): ThinkSplitState {
  return { inThink: false, closeTag: null, pending: '' };
}

/** 返回 s 末尾与 tag 前缀相等的最长长度（1..tag.length-1），用于跨分片保留半个标签 */
function trailingTagPrefixLen(s: string, tag: string): number {
  const max = Math.min(s.length, tag.length - 1);
  for (let k = max; k >= 1; k -= 1) {
    if (s.slice(s.length - k) === tag.slice(0, k)) return k;
  }
  return 0;
}

/** 在 buffer[i..] 中找最早出现的开标签；无则返回 null */
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

/** 块外：保留 buffer 末尾可能是任意开/闭标签前缀的最长残片 */
function trailingAnyTagPrefixLen(buffer: string, from: number): number {
  let keep = 0;
  for (const pair of THINK_TAG_PAIRS) {
    keep = Math.max(keep, trailingTagPrefixLen(buffer.slice(from), pair.open));
    keep = Math.max(keep, trailingTagPrefixLen(buffer.slice(from), pair.close));
  }
  return keep;
}

/**
 * 把一段正文增量按 think 标签拆成「正文」与「思考」两路增量（有状态、可跨 SSE 分片）。
 * @param state 该条流的拆分状态（会被就地更新）
 * @param delta 本帧 delta.content 增量
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

/** 流结束时清空 pending，避免半标签或未闭合 think 吞字 */
export function flushThinkDelta(state: ThinkSplitState): { content: string; reasoning: string } {
  const pending = state.pending;
  state.pending = '';
  if (!pending) return { content: '', reasoning: '' };
  return state.inThink ? { content: '', reasoning: pending } : { content: pending, reasoning: '' };
}

/**
 * 对完整字符串一次性拆分 think/正文（无状态，供非流式响应与展示层兜底）。
 * @param text 待拆分全文
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
 * 清理正文中可识别的内部执行日志。
 *
 * 返回 detected 供 reasoning 使用：思考字段一旦混入执行轨迹，整段不再展示，
 * 防止只删掉几行后仍泄露文件名、查询词或内部工作说明。
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
 * 归一化 assistant 展示用正文/思考：剥离 content 与 reasoning 中残留的内联 think 标签。
 * @param content 顶层正文
 * @param reasoning 已有思考字段（可为空）
 */
export function normalizeAssistantReply(
  content: string,
  reasoning?: string,
): { content: string; reasoning: string } {
  const fromContent = splitInlineThinkText(content);
  let fromReasoningField = '';
  if (reasoning) {
    const splitReasoning = splitInlineThinkText(reasoning);
    // 无内联标签时 split 会把全文落到 content 路，此处应整段视为思考文本
    fromReasoningField = splitReasoning.reasoning || splitReasoning.content;
  }

  const cleanedContent = stripInternalExecutionTrace(fromContent.content);
  const rawReasoning = [fromContent.reasoning, fromReasoningField].filter(Boolean).join('');
  const cleanedReasoning = stripInternalExecutionTrace(rawReasoning);

  return {
    content: cleanedContent.text,
    // 思考区不展示任何混入内部执行轨迹的原始内容；搜索过程由结构化状态区承载。
    reasoning: cleanedReasoning.detected ? '' : rawReasoning,
  };
}
