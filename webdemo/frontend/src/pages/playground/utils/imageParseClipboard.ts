import { copyText } from './copyText';

import type { ImageParseTextRange } from './imageParseBlocks';
import { imageParseNodeText, imageParseSourceBlocks } from './imageParseEditorSource';
import { splitJoinedDisplayFormulas } from './math-markdown';
import { extractMarkdownTables, markdownTablesToHtml, markdownTablesToTsv } from './markdownTable';

/**
 * 复制文档表格到剪贴板，同时写入 HTML 与纯文本两种格式。
 *
 * - `text/html`：飞书、Word 依赖它还原成真正的表格（纯文本粘过去只会退化成一行行文字）。
 * - `text/plain`：Excel 与各类表格软件依赖 TSV 分列。
 *
 * 浏览器不支持多格式写入或写入被拒时退回纯 TSV，至少保证表格软件仍可用。
 *
 * @param markdown 当前结果或草稿的 Markdown 正文
 * @returns 是否写入成功；正文里没有表格时返回 false
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
 * 给一段落在行间公式内部的正文补回 `$$`。已经带定界符时只做拆段。
 */
function restoreDisplayFormulaMarkdown(slice: string): string {
  const trimmed = slice.trim();
  if (!trimmed) return slice;
  return splitJoinedDisplayFormulas(trimmed.startsWith('$$') ? trimmed : `$$\n${trimmed}\n$$`);
}

/**
 * 复制范围两侧跳过空白后是否正好是一对 `$$`。
 * 多段粘在一起时，解析器会在第一处 `$$` 结束，整段范围不再落在同一个公式节点里。
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
 * 区块复制范围经常落在 `$$...$$` 内部，只含 LaTeX。
 * 先补回所在行间公式的定界符，粘在一起的多段再拆开。
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
 * 复制当前 OCR 区域：表格保留可粘贴的表格结构，普通内容去除 Markdown 标记。
 *
 * @param markdown 当前选中区域的 Markdown
 * @returns 是否写入成功；区域为空时返回 false
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
