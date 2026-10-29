import { copyText } from './copyText';

import type { ImageParseTextRange } from './imageParseBlocks';
import { imageParseNodeText, imageParseSourceBlocks } from './imageParseEditorSource';
import { splitJoinedDisplayFormulas } from './math-markdown';
import { extractMarkdownTables, markdownTablesToHtml, markdownTablesToTsv } from './markdownTable';

/**
 * Copy a document table to the clipboard, writing both HTML and plain text.
 *
 * - `text/html`: Feishu and Word depend on it to restore a real table (plain text pastes as lines of text).
 * - `text/plain`: Excel and other spreadsheet apps depend on TSV to split columns.
 *
 * When the browser cannot write multiple formats, or the write is rejected, fall back to plain TSV so spreadsheet apps still work.
 *
 * @param markdown Markdown body of the current result or draft
 * @returns whether the write succeeded; false when the body has no table
 */
export async function copyImageParseTable(markdown: string): Promise<boolean> {
  if (!extractMarkdownTables(markdown).length) return false;
  const text = markdownTablesToTsv(markdown);
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return copyText(text);
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([markdownTablesToHtml(markdown)], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      }),
    ]);
    return true;
  } catch {
    return copyText(text);
  }
}

/**
 * Put `$$` back around body text that falls inside a display formula. If delimiters are already present, only split the segments.
 */
function restoreDisplayFormulaMarkdown(slice: string): string {
  const trimmed = slice.trim();
  if (!trimmed) return slice;
  return splitJoinedDisplayFormulas(trimmed.startsWith('$$') ? trimmed : `$$\n${trimmed}\n$$`);
}

/**
 * Whether skipping whitespace on both sides of the copy range lands exactly on a pair of `$$`.
 * When several segments are stuck together, the parser ends at the first `$$`, and the whole range no longer falls inside the same formula node.
 */
function surroundedByDisplayFence(source: string, start: number, end: number): boolean {
  let before = start;
  while (before > 0 && /\s/.test(source[before - 1] ?? '')) before -= 1;
  let after = end;
  while (after < source.length && /\s/.test(source[after] ?? '')) after += 1;
  return (
    before >= 2 &&
    source[before - 2] === '$' &&
    source[before - 1] === '$' &&
    after + 1 < source.length &&
    source[after] === '$' &&
    source[after + 1] === '$'
  );
}

/**
 * A block copy range often falls inside `$$...$$` and contains only LaTeX.
 * Put the delimiters of that display formula back first, then split segments that are stuck together.
 */
export function imageParseCopyRegionMarkdown(source: string, range: ImageParseTextRange): string {
  const slice = source.slice(range.start, range.end);
  const host = imageParseSourceBlocks(source).find((node) => {
    if (node.type !== 'math') return false;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    return start !== undefined && end !== undefined && range.start >= start && range.end <= end;
  });
  if (host) {
    const start = host.position?.start.offset ?? range.start;
    const end = host.position?.end.offset ?? range.end;
    if (range.start <= start && range.end >= end) return slice;
    return restoreDisplayFormulaMarkdown(slice);
  }
  if (surroundedByDisplayFence(source, range.start, range.end)) {
    return restoreDisplayFormulaMarkdown(slice);
  }
  const split = splitJoinedDisplayFormulas(slice);
  if (split !== slice) return split;
  return slice;
}

/**
 * Copy the current OCR region: a table keeps a pasteable table structure, and ordinary content has Markdown markers removed.
 *
 * @param markdown Markdown of the currently selected region
 * @returns whether the write succeeded; false when the region is empty
 */
export async function copyImageParseRegion(markdown: string): Promise<boolean> {
  if (!markdown.trim()) return false;
  if (extractMarkdownTables(markdown).length) return copyImageParseTable(markdown);
  const text =
    imageParseSourceBlocks(markdown)
      .map((node) => imageParseNodeText(node, { mathDelimiters: true }))
      .join('\n\n')
      .trim() || markdown.trim();
  return copyText(text);
}
