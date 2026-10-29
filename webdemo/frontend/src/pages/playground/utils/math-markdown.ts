/**
 * Markdown 数学规范化的保护性切片。
 *
 * 用途：识别已有美元符公式、围栏代码、缩进代码和行内代码，供数学规范化器跳过这些区域。
 */

export interface ProtectedTextSegment {
  value: string;
  protected: boolean;
  kind?: 'inline-code' | 'block-code';
}

/**
 * KaTeX 不接受 `\bigg{[}` 这种把定界符再包一层花括号的写法，
 * 等价形式是 `\bigg[`。只改尺寸命令后面的定界符，代码区保持原样。
 */
export function unwrapSizedDelimiters(text: string): string {
  return splitMarkdownCode(text)
    .map((segment) => (segment.protected ? segment.value : unwrapSizedDelimiterRun(segment.value)))
    .join('');
}

/** 去掉 `\big`、`\left` 等命令后多余的定界符花括号。 */
function unwrapSizedDelimiterRun(text: string): string {
  return text.replace(
    /\\(Biggl|Biggr|biggl|biggr|Bigl|Bigr|bigl|bigr|Bigg|bigg|Big|big|left|right|middle)\{\s*(\\[{}|]|\\(?:lVert|rVert|lvert|rvert|langle|rangle|lfloor|rfloor|lceil|rceil|vert|Vert|uparrow|downarrow|updownarrow|Uparrow|Downarrow|Updownarrow|backslash)|[()[\]|./])\s*\}/g,
    '\\$1$2',
  );
}

/**
 * 把粘在同一处的多段 `$$...$$` 拆成各自独立的显示公式。
 * 单个公式保持原样；代码区不参与拆分。
 */
export function splitJoinedDisplayFormulas(text: string): string {
  return splitMarkdownCode(text)
    .map((segment) =>
      segment.protected ? segment.value : splitJoinedDisplayFormulaRun(segment.value),
    )
    .join('');
}

/** 在一段不含代码的正文里拆开仅由空白相连的显示公式。 */
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

/** 让拆开后的第一段公式从行首开始，避免 ` $$` 仍被当成普通段落。 */
function displayFormulaPrefix(prefix: string): string {
  if (prefix.endsWith('\n')) return prefix;
  const stripped = prefix.replace(/\s*$/, '');
  if (stripped.length < prefix.length) return stripped ? `${stripped}\n` : '\n';
  return prefix;
}

/** 查找下一个未转义的双美元符。 */
function indexOfUnescapedMarker(text: string, marker: string, from: number): number {
  for (let index = from; index <= text.length - marker.length; index += 1) {
    if (text.startsWith(marker, index) && !isEscaped(text, index)) return index;
  }
  return -1;
}

/** 把已有 `$...$` / `$$...$$` 切成保护片段，防止重复补定界符。 */
export function splitDollarMath(text: string): ProtectedTextSegment[] {
  const segments: ProtectedTextSegment[] = [];
  let plainStart = 0;
  let cursor = 0;
  while (cursor < text.length) {
    if (text[cursor] !== '$' || isEscaped(text, cursor)) {
      cursor += 1;
      continue;
    }
    // 单美元符必须自成一段，不能借用 `$$` 围栏里的某个字符充作闭合符。
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

/** 将 Markdown 围栏代码块、缩进代码块与行内代码切成保护片段。 */
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
 * 把模型误用反引号包裹的明确数学表达式转换为行内公式。
 *
 * 调用方负责完整数学语法校验；本层额外要求命令、Unicode 数学符号或至少两类数学结构，
 * 使普通路径、命令、单变量与代码仍保留 Markdown 代码语义。
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
 * 把普通文本中 `[ LaTeX ]` 形式的模型输出转换为行内公式。
 *
 * 方括号可出现在列表或说明文字内部，不能依赖整行裸公式判断；仅当括号内容通过调用方
 * 的数学校验时转换，并排除 Markdown 链接、图片、任务列表和普通引用编号。
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
 * 检测 Markdown 星号强调，避免把 `**标题**` / `*标签*` 的星号当成数学乘法。
 * 仅匹配符合 Markdown 边界的强调写法，不影响 `a*b*c` 等紧邻变量的乘法表达式。
 */
export function hasMarkdownAsteriskEmphasis(value: string): boolean {
  return (
    /\*\*(?=\S)[^*\n]+?\*\*/.test(value) ||
    /(?:^|[\s:])\*(?=\S)[^*\n]+?\*(?=$|[\s.,:;!?])/.test(value)
  );
}

/** 对行内代码采用比独占行更严格的数学结构判定，降低代码误转公式的风险。 */
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

/** 查找美元符数学片段的闭合定界符；行内公式不跨行。 */
function findDollarClose(text: string, from: number, marker: '$' | '$$'): number {
  for (let cursor = from; cursor < text.length; cursor += 1) {
    if (marker === '$' && text[cursor] === '\n') return -1;
    if (!text.startsWith(marker, cursor) || isEscaped(text, cursor)) continue;
    if (marker === '$' && (text[cursor - 1] === '$' || text[cursor + 1] === '$')) continue;
    return cursor;
  }
  return -1;
}

/** 查找未被反斜杠转义的指定字符。 */
function findNextUnescaped(text: string, character: string, from: number): number {
  for (let index = from; index < text.length; index += 1) {
    if (text[index] === character && !isEscaped(text, index)) return index;
  }
  return -1;
}

/** 查找支持嵌套的右方括号，兼容公式内的 `\left[...\right]` 与根式可选参数。 */
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

/** 判断当前行是否为 Markdown 四空格或 Tab 缩进代码行。 */
function isIndentedCodeLine(text: string, lineStart: number): boolean {
  return text.startsWith('    ', lineStart) || text[lineStart] === '\t';
}

/** 保护连续的 Markdown 缩进代码块；块内空行一并保留。 */
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

/** 读取 Markdown 围栏起始行。 */
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

/** 查找 Markdown 围栏闭合行；未闭合时保护到文本结尾。 */
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

/** 计算相同字符的连续长度。 */
function countRun(text: string, from: number, character: string): number {
  let cursor = from;
  while (text[cursor] === character) cursor += 1;
  return cursor - from;
}

/** 判断当前位置字符是否被奇数个反斜杠转义。 */
function isEscaped(value: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}
