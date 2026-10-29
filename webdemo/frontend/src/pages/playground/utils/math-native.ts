interface NativeMathOptions {
  protectedRanges?: readonly { start: number; end: number }[];
  onInline?: (start: number, end: number) => void;
  onReplace?: (start: number, end: number, openingLength: number, closingLength: number) => void;
}

/**
 * Choose an inline fence longer than dollar signs in the body, so remark and the editor do not truncate LaTeX body text.
 * @param latex formula without the outer delimiters
 * @returns a safe Markdown inline formula; when it contains no dollar sign, keep the standard single dollar sign
 */
export function inlineMathMarkdown(latex: string): string {
  const runs = latex.match(/\$+/g) ?? [];
  const length = runs.reduce((maximum, run) => Math.max(maximum, run.length + 1), 1);
  // Double dollar signs belong to the editor's block tokenizer; an inline formula that contains a dollar sign uses at least three.
  const marker = '$'.repeat(length === 1 ? 1 : Math.max(3, length));
  return marker + latex + marker;
}

interface NativeMathRange {
  start: number;
  end: number;
  value: string;
  display: boolean;
}

/** Skip the verbatim body of verb, so a delimiter inside it does not end the outer formula early. */
function verbEnd(text: string, start: number): number | undefined {
  const command = text.slice(start, start + 7).match(/^\\verb\*?([^A-Za-z\s])/);
  if (!command) return undefined;
  const from = start + command[0].length;
  const close = text.indexOf(command[1], from);
  return close < 0 ? text.length : close + 1;
}

/** Find the outer closing marker; paired backslashes and verb body text do not take part in delimiter matching. */
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
 * Scan native-formula boundaries once, without rewriting LaTeX body text or existing math/code ranges.
 * @param text text whose native delimiters have not been converted yet
 * @param protectedRanges protected ranges in source order
 * @returns source ranges and original body of complete native formulas; unclosed formulas are not included
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
    // When one is unclosed, stop scanning, so a large number of opening markers do not search the same remainder over and over.
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
 * Convert the outer markers of a native formula to Markdown delimiters, keeping the formula body.
 * @param text original Markdown text
 * @param options protected ranges and the inline-boundary callback
 * @returns text for remark-math
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
