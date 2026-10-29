/**
 * Math-formula delimiter normalization.
 *
 * Purpose: accept model output of `$...$`, `$$...$$`, `\(...\)`, `\[...\]`, bare LaTeX,
 * and math expressions that occupy a line with no command. KaTeX decides whether a specific command or environment is supported; MAP does not keep a syntax allowlist.
 * Markdown code regions and existing formulas stay as-is, so code, amounts, tables, or ordinary explanatory text are not mistaken for formulas.
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
  /** Whether to recognize and complete math expressions the model did not mark explicitly. */
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

/** A trailing `$ $$`: OCR occasionally writes the opening `$$` of a block formula and an extra `$` on the same line. */
const STRAY_DISPLAY_FENCE = /(^|\n)([^\n$]*)\$[ \t]*\$\$(?=[ \t]*(?:\r?\n|$))/g;

/** Native formulas should be recognized before dollar-sign slices inside the body, and existing dollar-sign formulas are skipped. */
function dollarRanges(text: string) {
  let cursor = 0;
  return splitDollarMath(text).flatMap((segment) => {
    const start = cursor;
    cursor += segment.value.length;
    return segment.protected ? [{ start, end: cursor }] : [];
  });
}

/** Raw HTML is left to the DOM formula transform, so attributes, code, and dollar-sign body text inside cells are not normalized early. */
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
 * Find a `prefix$ $$` fragment that can be repaired safely.
 *
 * Repair only when the whole-line prefix itself passes the bare-formula check, so amounts, code, or explanatory text are not pulled into the formula.
 * The `$$` after `$ $$` must already have been recognized as a paired formula; the repair deletes the extra `$` and the original `$$` opening,
 * and puts `$$` back at the start of the line.
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
    // A `$` can also appear inside a multi-line formula body, and must not be mistaken for an OCR fragment inside the formula.
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
 * Apply a text edit, and keep a monotonic map from original offsets to the normalized text.
 *
 * Offsets inside a deleted range all land at the end of the replacement; block highlighting only needs to land stably inside the same semantic block.
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

/** Document preview only repairs formula delimiters and does not infer bare LaTeX; bare-formula recognition is controlled separately by the chat scene. */
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
 * Document formula normalization also records a segmented offset map, so each OCR block does not rescan the whole prefix.
 * @param content original Markdown; code and existing dollar-sign formulas stay as-is
 * @returns normalized text and a binary map from original boundaries to preview boundaries
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
 * Full formula normalization for document preview.
 *
 * First split a stuck-together `$$ $$` that `\] \[` collapsed into, then repair delimiters. When there is no such rewrite, keep the offsets from one scan;
 * after the split, align by prefix length, consistent with the previous document render going through `normalizeMathDelimiters`.
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
 * Normalize math formulas in model output, skipping Markdown code regions.
 *
 * @param content original Markdown text
 * @param options math recognition options
 * @returns Markdown that can be handed to remark-math and KaTeX
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
