/**
 * 数学公式定界符规范化。
 *
 * 用途：兼容模型输出的 `$...$`、`$$...$$`、`\(...\)`、`\[...\]`、裸 LaTeX
 * 以及无命令的独占行数学表达式。KaTeX 负责判断具体命令和环境是否受支持，MAP 不维护语法白名单。
 * Markdown 代码区和已有公式保持原样，避免把代码、金额、表格或普通说明文字误判为公式。
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';

import { isBareMath, normalizeInlineCodeMath, wrapBareMath } from './math-katex';
import {
  splitDollarMath,
  splitJoinedDisplayFormulas,
  splitMarkdownCode,
  unwrapSizedDelimiters,
  type ProtectedTextSegment,
} from './math-markdown';
import { inlineMathMarkdown, nativeMathRanges, replaceNativeMathDelimiters } from './math-native';

interface NormalizeMathDelimitersOptions {
  /** 是否识别并补齐模型未显式标记的数学表达式。 */
  detectBareMath?: boolean;
}

const DOCUMENT_PARSER = unified().use(remarkParse).use(remarkMath);

interface MathTextEdit {
  start: number;
  end: number;
  replacement: string;
}

interface OffsetMapRange {
  sourceStart: number;
  sourceEnd: number;
  targetStart: number;
  targetEnd: number;
  edited: boolean;
}

interface DisplayFenceRepair {
  lineStart: number;
  deletionStart: number;
  deletionEnd: number;
}

/** 行尾 `$ $$`：OCR 偶发把块级公式开头的 `$$` 与一个多余的 `$` 混写在同一行。 */
const STRAY_DISPLAY_FENCE = /(^|\n)([^\n$]*)\$[ \t]*\$\$(?=[ \t]*(?:\r?\n|$))/g;

/** 原生公式应在正文内美元符切片之前识别，同时跳过已有美元符公式。 */
function dollarRanges(text: string) {
  let cursor = 0;
  return splitDollarMath(text).flatMap((segment) => {
    const start = cursor;
    cursor += segment.value.length;
    return segment.protected ? [{ start, end: cursor }] : [];
  });
}

/** 原始 HTML 交由 DOM 公式转换，避免提前规范化属性、代码及单元格内美元符正文。 */
function splitDocumentHtml(content: string): ProtectedTextSegment[] {
  if (!content.includes('<')) return splitMarkdownCode(content);
  const tree = DOCUMENT_PARSER.parse(content);
  const ranges: { start: number; end: number }[] = [];
  function visit(node: {
    type: string;
    children?: typeof tree.children;
    position?: { start: { offset?: number }; end: { offset?: number } };
  }) {
    if (node.type === 'html') {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) ranges.push({ start, end });
      return;
    }
    node.children?.forEach(visit);
  }
  visit(tree);
  const segments: ProtectedTextSegment[] = [];
  let cursor = 0;
  for (const { start, end } of ranges) {
    segments.push(...splitMarkdownCode(content.slice(cursor, start)));
    segments.push({ value: content.slice(start, end), protected: true });
    cursor = end;
  }
  segments.push(...splitMarkdownCode(content.slice(cursor)));
  return segments;
}

/**
 * 找出可安全修复的 `prefix$ $$` 残片。
 *
 * 只有整行前缀本身能通过裸公式校验时才修复，避免把金额、代码或说明文字并进公式。
 * `$ $$` 后面的 `$$` 必须已被识别为成对公式；修复时删除多余的 `$` 与原 `$$` 开头，
 * 并在行首补回 `$$`。
 */
function displayFenceRepairs(
  text: string,
  protectedRanges: readonly { start: number; end: number }[],
): DisplayFenceRepair[] {
  const repairs: DisplayFenceRepair[] = [];
  STRAY_DISPLAY_FENCE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = STRAY_DISPLAY_FENCE.exec(text))) {
    const lineStart = match.index + match[1].length;
    const prefix = match[2];
    if (!isBareMath(prefix.trim())) continue;
    // 多行公式正文里也可能出现 `$`，不能把公式内部误当成 OCR 残片。
    if (protectedRanges.some((range) => range.start < lineStart && range.end > lineStart)) {
      continue;
    }
    const strayStart = lineStart + prefix.length;
    const openStart = match.index + match[0].length - 2;
    if (!protectedRanges.some((range) => range.start === openStart)) continue;
    repairs.push({ lineStart, deletionStart: strayStart, deletionEnd: openStart + 2 });
  }
  return repairs;
}

/**
 * 应用文本编辑，并保留原始偏移到规范化文本的单调映射。
 *
 * 删除区间内部的偏移统一落到替换内容末尾；块级高亮只需要稳定落在同一语义块内。
 */
function applyTextEdits(text: string, edits: readonly MathTextEdit[]) {
  const sorted = [...edits].sort((left, right) => left.start - right.start || left.end - right.end);
  const ranges: OffsetMapRange[] = [];
  let output = '';
  let cursor = 0;
  for (const edit of sorted) {
    if (edit.start < cursor || edit.end < edit.start) continue;
    if (edit.start > cursor) {
      const source = text.slice(cursor, edit.start);
      ranges.push({
        sourceStart: cursor,
        sourceEnd: edit.start,
        targetStart: output.length,
        targetEnd: output.length + source.length,
        edited: false,
      });
      output += source;
    }
    const targetStart = output.length;
    output += edit.replacement;
    ranges.push({
      sourceStart: edit.start,
      sourceEnd: edit.end,
      targetStart,
      targetEnd: output.length,
      edited: true,
    });
    cursor = edit.end;
  }
  if (cursor < text.length || !ranges.length) {
    const source = text.slice(cursor);
    ranges.push({
      sourceStart: cursor,
      sourceEnd: text.length,
      targetStart: output.length,
      targetEnd: output.length + source.length,
      edited: false,
    });
    output += source;
  }
  const mapOffset = (offset: number) => {
    const target = Math.max(0, Math.min(offset, text.length));
    let low = 0;
    let high = ranges.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (ranges[middle].sourceStart <= target) low = middle + 1;
      else high = middle;
    }
    const range = ranges[low - 1];
    if (!range) return 0;
    if (!range.edited) {
      return range.targetStart + Math.min(target, range.sourceEnd) - range.sourceStart;
    }
    return target <= range.sourceStart ? range.targetStart : range.targetEnd;
  };
  return { content: output, mapOffset };
}

/** 文档预览只修复公式定界符，不推断裸 LaTeX；裸公式识别由对话场景单独控制。 */
function documentMathEdits(
  text: string,
  protectedRanges: readonly { start: number; end: number }[],
): MathTextEdit[] {
  const repairs = displayFenceRepairs(text, protectedRanges);
  const edits: MathTextEdit[] = [];
  for (const repair of repairs) {
    edits.push(
      { start: repair.lineStart, end: repair.lineStart, replacement: '$$\n' },
      { start: repair.deletionStart, end: repair.deletionEnd, replacement: '' },
    );
  }
  for (const range of nativeMathRanges(text, protectedRanges)) {
    if (
      repairs.some((repair) => range.start < repair.deletionEnd && range.end > repair.deletionStart)
    ) {
      continue;
    }
    edits.push({
      start: range.start,
      end: range.end,
      replacement: range.display ? `\n$$\n${range.value}\n$$\n` : inlineMathMarkdown(range.value),
    });
  }
  return edits;
}

/**
 * 文档公式规范化同时记录分段偏移映射，避免每个 OCR 块重复扫描整段前缀。
 * @param content 原始 Markdown；代码与已有美元符公式保持原样
 * @returns 规范化文本与原始边界到预览边界的二分映射
 */
export function normalizeDocumentMathDelimiters(content: string) {
  const mappings: {
    sourceStart: number;
    sourceEnd: number;
    targetStart: number;
    targetEnd: number;
    mapOffset?: (offset: number) => number;
  }[] = [];
  let normalized = '';
  let sourceStart = 0;
  for (const code of splitDocumentHtml(content)) {
    const sourceEnd = sourceStart + code.value.length;
    const targetStart = normalized.length;
    if (code.protected) {
      normalized += code.value;
      mappings.push({ sourceStart, sourceEnd, targetStart, targetEnd: normalized.length });
    } else {
      const edited = applyTextEdits(
        code.value,
        documentMathEdits(code.value, dollarRanges(code.value)),
      );
      normalized += edited.content;
      mappings.push({
        sourceStart,
        sourceEnd,
        targetStart,
        targetEnd: normalized.length,
        mapOffset: edited.mapOffset,
      });
    }
    sourceStart = sourceEnd;
  }
  return {
    content: normalized,
    mapOffset: (offset: number) => {
      const target = Math.max(0, Math.min(offset, content.length));
      let low = 0;
      let high = mappings.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (mappings[middle].sourceStart <= target) low = middle + 1;
        else high = middle;
      }
      const mapping = mappings[low - 1];
      if (!mapping) return 0;
      if (!mapping.mapOffset) {
        return mapping.targetStart + Math.min(target, mapping.sourceEnd) - mapping.sourceStart;
      }
      return mapping.targetStart + mapping.mapOffset(target - mapping.sourceStart);
    },
  };
}

/**
 * 文档预览的完整公式规范化。
 *
 * 先拆开 `\] \[` 收成的粘连 `$$ $$`，再修定界符。没有这些改写时沿用一次扫描的偏移；
 * 拆开后按前缀长度对齐，和原先文档渲染走 `normalizeMathDelimiters` 的结果一致。
 */
export function prepareDocumentMath(content: string) {
  const prepared = splitJoinedDisplayFormulas(unwrapSizedDelimiters(content));
  const math = normalizeDocumentMathDelimiters(prepared);
  if (prepared === content) return math;
  return {
    content: math.content,
    mapOffset: (offset: number) =>
      normalizeMathDelimiters(content.slice(0, Math.max(0, Math.min(offset, content.length))), {
        detectBareMath: false,
      }).length,
  };
}

/**
 * 规范化模型输出中的数学公式，跳过 Markdown 代码区。
 *
 * @param content 原始 Markdown 文本
 * @param options 数学识别选项
 * @returns 可交给 remark-math 与 KaTeX 渲染的 Markdown
 */
export function normalizeMathDelimiters(
  content: string,
  { detectBareMath = true }: NormalizeMathDelimitersOptions = {},
): string {
  if (!content) return content;
  content = unwrapSizedDelimiters(content);
  content = splitJoinedDisplayFormulas(content);
  if (!detectBareMath) return normalizeDocumentMathDelimiters(content).content;
  return splitMarkdownCode(content)
    .map((codeSegment) => {
      if (codeSegment.protected) {
        return codeSegment.kind === 'inline-code' && detectBareMath
          ? normalizeInlineCodeMath(codeSegment.value)
          : codeSegment.value;
      }
      const withNativeDelimiters = replaceNativeMathDelimiters(codeSegment.value, {
        protectedRanges: dollarRanges(codeSegment.value),
      });
      return splitDollarMath(withNativeDelimiters)
        .map((segment) => (segment.protected ? segment.value : wrapBareMath(segment.value)))
        .join('');
    })
    .join('');
}
