interface NativeMathOptions {
  protectedRanges?: readonly { start: number; end: number }[];
  onInline?: (start: number, end: number) => void;
  onReplace?: (start: number, end: number, openingLength: number, closingLength: number) => void;
}

/**
 * 选择比正文美元符更长的行内围栏，避免 remark 与编辑器截断 LaTeX 正文。
 * @param latex 不包含外层定界符的公式
 * @returns 安全的 Markdown 行内公式；不含美元符时保持标准单美元符
 */
export function inlineMathMarkdown(latex: string): string {
  const runs = latex.match(/\$+/g) ?? [];
  const length = runs.reduce((maximum, run) => Math.max(maximum, run.length + 1), 1);
  // 双美元符由编辑器块级 tokenizer 所有；含美元符的行内公式使用至少三个。
  const marker = '$'.repeat(length === 1 ? 1 : Math.max(3, length));
  return marker + latex + marker;
}

interface NativeMathRange {
  start: number;
  end: number;
  value: string;
  display: boolean;
}

/** 跳过 verb 的逐字正文，避免其中的定界符提前结束外层公式。 */
function verbEnd(text: string, start: number): number | undefined {
  const command = text.slice(start, start + 7).match(/^\\verb\*?([^A-Za-z\s])/);
  if (!command) return undefined;
  const from = start + command[0].length;
  const close = text.indexOf(command[1], from);
  return close < 0 ? text.length : close + 1;
}

/** 查找外层闭合标记；成对反斜杠和 verb 正文不参与定界符匹配。 */
function nativeMathEnd(text: string, from: number, closing: string): number {
  let cursor = from;
  while (cursor < text.length) {
    if (text[cursor] !== '\\') {
      cursor += 1;
      continue;
    }
    const end = verbEnd(text, cursor);
    if (end !== undefined) {
      cursor = end;
      continue;
    }
    if (text[cursor + 1] === closing) return cursor;
    cursor += 2;
  }
  return -1;
}

/**
 * 单次扫描原生公式边界，不重写 LaTeX 正文或已有数学/代码范围。
 * @param text 尚未转换原生定界符的文字
 * @param protectedRanges 按源码顺序的保护范围
 * @returns 完整原生公式的源码范围与原始正文；不包含未闭合公式
 */
export function nativeMathRanges(
  text: string,
  protectedRanges: NativeMathOptions['protectedRanges'] = [],
): NativeMathRange[] {
  const ranges: NativeMathRange[] = [];
  let cursor = 0;
  let rangeIndex = 0;
  while (cursor < text.length) {
    while (protectedRanges[rangeIndex]?.end <= cursor) rangeIndex += 1;
    const protectedRange = protectedRanges[rangeIndex];
    if (protectedRange && cursor >= protectedRange.start) {
      cursor = protectedRange.end;
      continue;
    }
    if (text[cursor] !== '\\') {
      cursor += 1;
      continue;
    }
    const opening = text[cursor + 1];
    if (opening !== '(' && opening !== '[') {
      cursor += 2;
      continue;
    }
    const close = nativeMathEnd(text, cursor + 2, opening === '(' ? ')' : ']');
    // 未闭合时停止扫描，避免大量起始标记反复搜索同一段剩余文本。
    if (close < 0) break;
    if (close === cursor + 2) {
      cursor = close + 2;
      continue;
    }
    ranges.push({
      start: cursor,
      end: close + 2,
      value: text.slice(cursor + 2, close),
      display: opening === '[',
    });
    cursor = close + 2;
  }
  return ranges;
}

/**
 * 将原生公式外层标记转换为 Markdown 定界符，保留公式正文。
 * @param text 原始 Markdown 文本
 * @param options 保护范围与行内边界回调
 * @returns 供 remark-math 使用的文本
 */
export function replaceNativeMathDelimiters(
  text: string,
  { protectedRanges = [], onInline, onReplace }: NativeMathOptions = {},
): string {
  let result = '';
  let cursor = 0;
  for (const range of nativeMathRanges(text, protectedRanges)) {
    const replacement = range.display
      ? `\n$$\n${range.value}\n$$\n`
      : inlineMathMarkdown(range.value);
    const markerLength = (replacement.length - range.value.length) / 2;
    result += text.slice(cursor, range.start) + replacement;
    if (!range.display) onInline?.(range.start, range.end);
    onReplace?.(range.start, range.end, markerLength, markerLength);
    cursor = range.end;
  }
  return result + text.slice(cursor);
}
