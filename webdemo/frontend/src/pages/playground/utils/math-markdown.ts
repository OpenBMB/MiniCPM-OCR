/**
 * Protective slices for Markdown math normalization.
 *
 * Purpose: recognize existing dollar-sign formulas, fenced code, indented code, and inline code, so the math normalizer skips those regions.
 */

export interface ProtectedTextSegment {
  value: string;
  protected: boolean;
  kind?: 'inline-code' | 'block-code';
}

/**
 * KaTeX does not accept a form such as `\bigg{[}` that wraps the delimiter in another pair of braces;
 * the equivalent form is `\bigg[`. Only change the delimiter after a sizing command, and leave code regions as-is.
 */
export function unwrapSizedDelimiters(text: string): string {
  return splitMarkdownCode(text)
    .map((segment) => (segment.protected ? segment.value : unwrapSizedDelimiterRun(segment.value)))
    .join('');
}

/** Remove extra delimiter braces after commands such as `\big` and `\left`. */
function unwrapSizedDelimiterRun(text: string): string {
  return text.replace(
    /\\(Biggl|Biggr|biggl|biggr|Bigl|Bigr|bigl|bigr|Bigg|bigg|Big|big|left|right|middle)\{\s*(\\[{}|]|\\(?:lVert|rVert|lvert|rvert|langle|rangle|lfloor|rfloor|lceil|rceil|vert|Vert|uparrow|downarrow|updownarrow|Uparrow|Downarrow|Updownarrow|backslash)|[()[\]|./])\s*\}/g,
    '\\$1$2',
  );
}

/**
 * Split several `$$...$$` segments stuck together into independent display formulas.
 * A single formula stays as-is; code regions do not take part in the split.
 */
export function splitJoinedDisplayFormulas(text: string): string {
  return splitMarkdownCode(text)
    .map((segment) =>
      segment.protected ? segment.value : splitJoinedDisplayFormulaRun(segment.value),
    )
    .join('');
}

/** Inside a stretch of body text that contains no code, split display formulas that are joined only by whitespace. */
function splitJoinedDisplayFormulaRun(text: string): string {
  let output = '';
  let cursor = 0;
  while (cursor < text.length) {
    const open = indexOfUnescapedMarker(text, '$$', cursor);
    if (open < 0) {
      output += text.slice(cursor);
      break;
    }
    const formulas: string[] = [];
    let position = open;
    let end = open;
    while (
      position < text.length &&
      text.startsWith('$$', position) &&
      !isEscaped(text, position)
    ) {
      const close = findDollarClose(text, position + 2, '$$');
      if (close < 0) break;
      const latex = text.slice(position + 2, close).trim();
      if (!latex) break;
      formulas.push(latex);
      end = close + 2;
      let look = end;
      while (look < text.length && /\s/.test(text[look] ?? '')) look += 1;
      if (look < text.length && text.startsWith('$$', look) && !isEscaped(text, look)) {
        position = look;
        continue;
      }
      break;
    }
    if (formulas.length >= 2) {
      output += displayFormulaPrefix(text.slice(cursor, open));
      output += formulas.map((latex) => `$$\n${latex}\n$$`).join('\n\n');
      cursor = end;
      continue;
    }
    output += text.slice(cursor, open + 2);
    cursor = open + 2;
  }
  return output;
}

/** Make the first formula after a split start at the beginning of the line, so ` $$` is not still treated as an ordinary paragraph. */
function displayFormulaPrefix(prefix: string): string {
  if (prefix.endsWith('\n')) return prefix;
  const stripped = prefix.replace(/\s*$/, '');
  if (stripped.length < prefix.length) return stripped ? `${stripped}\n` : '\n';
  return prefix;
}

/** Find the next unescaped double dollar sign. */
function indexOfUnescapedMarker(text: string, marker: string, from: number): number {
  for (let index = from; index <= text.length - marker.length; index += 1) {
    if (text.startsWith(marker, index) && !isEscaped(text, index)) return index;
  }
  return -1;
}

/** Slice existing `$...$` / `$$...$$` into protected fragments, so delimiters are not added twice. */
export function splitDollarMath(text: string): ProtectedTextSegment[] {
  const segments: ProtectedTextSegment[] = [];
  let plainStart = 0;
  let cursor = 0;
  while (cursor < text.length) {
    if (text[cursor] !== '$' || isEscaped(text, cursor)) {
      cursor += 1;
      continue;
    }
    // A single dollar sign must be its own segment, and must not borrow a character inside a `$$` fence as its closer.
    const marker = countRun(text, cursor, '$') === 1 ? '$' : '$$';
    const close = findDollarClose(text, cursor + marker.length, marker);
    if (close < 0) {
      cursor += marker.length;
      continue;
    }
    if (plainStart < cursor) {
      segments.push({ value: text.slice(plainStart, cursor), protected: false });
    }
    const end = close + marker.length;
    segments.push({ value: text.slice(cursor, end), protected: true });
    cursor = end;
    plainStart = end;
  }
  if (plainStart < text.length) segments.push({ value: text.slice(plainStart), protected: false });
  return segments;
}

/** Slice Markdown fenced code blocks, indented code blocks, and inline code into protected fragments. */
export function splitMarkdownCode(text: string): ProtectedTextSegment[] {
  const segments: ProtectedTextSegment[] = [];
  let plainStart = 0;
  let cursor = 0;
  while (cursor < text.length) {
    if (cursor === 0 || text[cursor - 1] === '\n') {
      if (isIndentedCodeLine(text, cursor)) {
        if (plainStart < cursor) {
          segments.push({ value: text.slice(plainStart, cursor), protected: false });
        }
        const end = findIndentedCodeEnd(text, cursor);
        segments.push({ value: text.slice(cursor, end), protected: true, kind: 'block-code' });
        cursor = end;
        plainStart = end;
        continue;
      }
      const fence = readFenceStart(text, cursor);
      if (fence) {
        if (plainStart < cursor) {
          segments.push({ value: text.slice(plainStart, cursor), protected: false });
        }
        const end = findFenceEnd(text, fence.contentStart, fence.marker, fence.length);
        segments.push({ value: text.slice(cursor, end), protected: true, kind: 'block-code' });
        cursor = end;
        plainStart = end;
        continue;
      }
    }
    if (text[cursor] === '`') {
      const length = countRun(text, cursor, '`');
      const delimiter = '`'.repeat(length);
      const close = text.indexOf(delimiter, cursor + length);
      if (close >= 0) {
        if (plainStart < cursor) {
          segments.push({ value: text.slice(plainStart, cursor), protected: false });
        }
        const end = close + length;
        segments.push({ value: text.slice(cursor, end), protected: true, kind: 'inline-code' });
        cursor = end;
        plainStart = end;
        continue;
      }
    }
    cursor += 1;
  }
  if (plainStart < text.length) segments.push({ value: text.slice(plainStart), protected: false });
  return segments;
}

/**
 * Turn an explicit math expression the model wrapped in backticks by mistake into an inline formula.
 *
 * The caller is responsible for a full math-syntax check; this layer additionally requires a command, a Unicode math symbol, or at least two kinds of math structure,
 * so an ordinary path, command, single variable, and code still keep Markdown code semantics.
 */
export function normalizeInlineCodeMath(
  codeSpan: string,
  isMath: (value: string) => boolean,
): string {
  const marker = codeSpan.match(/^`+/)?.[0] ?? '';
  if (!marker || !codeSpan.endsWith(marker)) return codeSpan;
  const value = codeSpan.slice(marker.length, -marker.length).trim();
  if (!isLikelyInlineCodeMath(value, isMath)) return codeSpan;
  return `$${value}$`;
}

/**
 * Turn model output of the form `[ LaTeX ]` in ordinary text into an inline formula.
 *
 * Brackets can appear inside a list or explanatory text, so this cannot rely on a whole-line bare-formula check; convert only when the bracket contents pass the caller's
 * math check, and exclude Markdown links, images, task lists, and ordinary citation numbers.
 */
export function wrapBracketedMath(text: string, isMath: (value: string) => boolean): string {
  let cursor = 0;
  let output = '';
  while (cursor < text.length) {
    const open = findNextUnescaped(text, '[', cursor);
    if (open < 0) return output + text.slice(cursor);
    const close = findClosingSquareBracket(text, open);
    if (close < 0) return output + text.slice(cursor);

    output += text.slice(cursor, open);
    const body = text.slice(open + 1, close);
    const next = text[close + 1];
    const isMarkdownLink = next === '(' || next === '[' || text[open - 1] === '!';
    output += !isMarkdownLink && isMath(body.trim()) ? `$${body}$` : text.slice(open, close + 1);
    cursor = close + 1;
  }
  return output;
}

/**
 * Detect Markdown asterisk emphasis, so the asterisks of `**title**` / `*label*` are not treated as math multiplication.
 * Match only emphasis that fits Markdown boundaries, and do not affect multiplication such as `a*b*c` between adjacent variables.
 */
export function hasMarkdownAsteriskEmphasis(value: string): boolean {
  return (
    /\*\*(?=\S)[^*\n]+?\*\*/.test(value) ||
    /(?:^|[\s:])\*(?=\S)[^*\n]+?\*(?=$|[\s.,:;!?])/.test(value)
  );
}

/** Use a stricter math-structure check for inline code than for a line on its own, so code is less likely to be turned into a formula by mistake. */
function isLikelyInlineCodeMath(value: string, isMath: (value: string) => boolean): boolean {
  if (!isMath(value)) return false;
  if (/\\[A-Za-z@]+/.test(value)) return true;
  if (/[∑∏∫√±∓×÷≤≥≠≈≃≅∝∈∉⊂⊃⊆⊇→←↔⇒⇐⇔]/.test(value)) return true;

  const structures = [
    /[=<>≤≥≠≈≃≅∝∈∉⊂⊃⊆⊇→←↔⇒⇐⇔]/.test(value),
    /[_^]/.test(value),
    /[+\-*/×÷±∓·⋅∘]/.test(value),
    /(?:^|[^A-Za-z])[A-Za-z]\s*\([^)]*\)/.test(value),
  ];
  return structures.filter(Boolean).length >= 2;
}

/** Find the closing delimiter of a dollar-sign math fragment; an inline formula does not cross lines. */
function findDollarClose(text: string, from: number, marker: '$' | '$$'): number {
  for (let cursor = from; cursor < text.length; cursor += 1) {
    if (marker === '$' && text[cursor] === '\n') return -1;
    if (!text.startsWith(marker, cursor) || isEscaped(text, cursor)) continue;
    if (marker === '$' && (text[cursor - 1] === '$' || text[cursor + 1] === '$')) continue;
    return cursor;
  }
  return -1;
}

/** Find the given character when it is not escaped by a backslash. */
function findNextUnescaped(text: string, character: string, from: number): number {
  for (let index = from; index < text.length; index += 1) {
    if (text[index] === character && !isEscaped(text, index)) return index;
  }
  return -1;
}

/** Find a right bracket that supports nesting, compatible with `\left[...\right]` inside a formula and optional radical arguments. */
function findClosingSquareBracket(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (isEscaped(text, index)) continue;
    if (text[index] === '[') depth += 1;
    if (text[index] === ']') depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

/** Whether the current line is a Markdown indented code line of four spaces or a tab. */
function isIndentedCodeLine(text: string, lineStart: number): boolean {
  return text.startsWith('    ', lineStart) || text[lineStart] === '\t';
}

/** Protect a contiguous Markdown indented code block; blank lines inside the block are kept too. */
function findIndentedCodeEnd(text: string, from: number): number {
  let lineStart = from;
  while (lineStart < text.length) {
    const lineEnd = text.indexOf('\n', lineStart);
    const end = lineEnd < 0 ? text.length : lineEnd + 1;
    const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
    if (line.trim() && !isIndentedCodeLine(text, lineStart)) return lineStart;
    lineStart = end;
  }
  return text.length;
}

/** Read the opening line of a Markdown fence. */
function readFenceStart(
  text: string,
  lineStart: number,
): { marker: '`' | '~'; length: number; contentStart: number } | undefined {
  let markerStart = lineStart;
  while (markerStart < text.length && text[markerStart] === ' ' && markerStart - lineStart < 3) {
    markerStart += 1;
  }
  const marker = text[markerStart];
  if (marker !== '`' && marker !== '~') return undefined;
  const length = countRun(text, markerStart, marker);
  if (length < 3) return undefined;
  const lineEnd = text.indexOf('\n', markerStart + length);
  return {
    marker,
    length,
    contentStart: lineEnd < 0 ? text.length : lineEnd + 1,
  };
}

/** Find the Markdown fence closing line; when it is unclosed, protect through the end of the text. */
function findFenceEnd(
  text: string,
  from: number,
  marker: '`' | '~',
  minimumLength: number,
): number {
  let lineStart = from;
  while (lineStart < text.length) {
    let markerStart = lineStart;
    while (markerStart < text.length && text[markerStart] === ' ' && markerStart - lineStart < 3) {
      markerStart += 1;
    }
    const length = countRun(text, markerStart, marker);
    const lineEnd = text.indexOf('\n', markerStart + length);
    const end = lineEnd < 0 ? text.length : lineEnd + 1;
    if (
      length >= minimumLength &&
      text.slice(markerStart + length, lineEnd < 0 ? text.length : lineEnd).trim() === ''
    ) {
      return end;
    }
    lineStart = end;
  }
  return text.length;
}

/** Count the run length of the same character. */
function countRun(text: string, from: number, character: string): number {
  let cursor = from;
  while (text[cursor] === character) cursor += 1;
  return cursor - from;
}

/** Whether the character at the current position is escaped by an odd number of backslashes. */
function isEscaped(value: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}
