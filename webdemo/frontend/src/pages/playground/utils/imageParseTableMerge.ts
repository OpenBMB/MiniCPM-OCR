import type { ImageParseSdkResult } from '@/api/map/imageParseSdk';

import type { ImageParseLayoutBlock } from './imageParseSample';
import {
  imageParseBlockId,
  imageParseBlockRegions,
  imageParseBlockRanges,
  type ImageParseTextRange,
} from './imageParseBlocks';

/** 只忽略页面装饰块；页脚之后的表格仍视为页末内容。 */
const PAGE_DECORATION_KINDS = new Set<ImageParseLayoutBlock['kind']>(['header', 'footer']);

interface TableCandidate {
  blockIndex: number;
  block: ImageParseLayoutBlock;
  range: ImageParseTextRange;
  table: HTMLTableElement;
  width: number;
}

interface PageTable {
  page: number;
  result: ImageParseSdkResult;
  first?: TableCandidate;
  last?: TableCandidate;
}

/** 单元格合并后表格的列数；rowspan 占位必须计入后续行的宽度。 */
function tableWidth(table: HTMLTableElement): number {
  const occupied: boolean[][] = [];
  let width = 0;
  const rows = Array.from(table.rows);
  rows.forEach((row, rowIndex) => {
    let column = 0;
    for (const cell of Array.from(row.cells)) {
      while (occupied[rowIndex]?.[column]) column += 1;
      const rawRowSpan = Number.parseInt(cell.getAttribute('rowspan') ?? '1', 10);
      const rowSpan =
        rawRowSpan === 0
          ? Math.max(1, rows.length - rowIndex)
          : Math.max(1, Number.isFinite(rawRowSpan) ? rawRowSpan : 1);
      const rawColSpan = Number.parseInt(cell.getAttribute('colspan') ?? '1', 10);
      const colSpan = Math.max(1, Number.isFinite(rawColSpan) ? rawColSpan : 1);
      for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
        occupied[rowIndex + rowOffset] ??= [];
        for (let columnOffset = 0; columnOffset < colSpan; columnOffset += 1) {
          occupied[rowIndex + rowOffset]![column + columnOffset] = true;
        }
      }
      column += colSpan;
      width = Math.max(width, column);
    }
  });
  return width;
}

function parseTable(html: string): HTMLTableElement | undefined {
  if (!html.trim().startsWith('<table') || typeof DOMParser === 'undefined') return undefined;
  const document = new DOMParser().parseFromString(html, 'text/html');
  const tables = document.querySelectorAll('table');
  if (tables.length !== 1) return undefined;
  return tables[0] as HTMLTableElement;
}

function normalizedCellKey(cell: HTMLTableCellElement): string {
  return [
    cell.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    cell.getAttribute('colspan') ?? '1',
    cell.getAttribute('rowspan') ?? '1',
  ].join('\u0000');
}

function sameHeaderRow(left: HTMLTableRowElement, right: HTMLTableRowElement): boolean {
  if (left.cells.length !== right.cells.length) return false;
  return Array.from(left.cells).every(
    (cell, index) => normalizedCellKey(cell) === normalizedCellKey(right.cells[index]!),
  );
}

/** 表头可能占两行；只有 th 或跨行/跨列单元格才参与续页重复表头剔除。 */
function looksLikeHeaderRow(row: HTMLTableRowElement): boolean {
  return Array.from(row.cells).some(
    (cell) =>
      cell.tagName.toLowerCase() === 'th' ||
      Number.parseInt(cell.getAttribute('rowspan') ?? '1', 10) > 1 ||
      Number.parseInt(cell.getAttribute('colspan') ?? '1', 10) > 1,
  );
}

function repeatedHeaderRows(previous: HTMLTableElement, next: HTMLTableElement): number {
  let count = 0;
  while (
    count < previous.rows.length &&
    count < next.rows.length &&
    looksLikeHeaderRow(next.rows[count]!) &&
    sameHeaderRow(previous.rows[count]!, next.rows[count]!)
  )
    count += 1;
  return count;
}

function contentBlockIndexes(blocks: readonly ImageParseLayoutBlock[]): number[] {
  return blocks.flatMap((block, index) => (PAGE_DECORATION_KINDS.has(block.kind) ? [] : [index]));
}

function tableCandidateAt(
  result: ImageParseSdkResult,
  blockIndex: number,
): TableCandidate | undefined {
  const block = result.blocks[blockIndex];
  if (!block) return undefined;
  if (
    block.kind !== 'table' ||
    block.mergedIntoPreviousPage ||
    (block.status && block.status !== 'ok')
  )
    return undefined;
  const raw = block.markdown || block.text;
  const table = parseTable(raw);
  if (!table) return undefined;
  const ranges = imageParseBlockRanges(result.markdown, result.blocks);
  let range = ranges.get(imageParseBlockId(block, blockIndex));
  if (!range) {
    const start = result.markdown.indexOf(raw);
    if (start < 0) return undefined;
    range = { start, end: start + raw.length };
  }
  if (result.markdown.slice(range.start, range.end) !== raw) return undefined;
  const width = tableWidth(table);
  if (width <= 0) return undefined;
  return { blockIndex, block, range, table, width };
}

function tableCandidate(
  result: ImageParseSdkResult,
  position: 'first' | 'last',
): TableCandidate | undefined {
  const content = contentBlockIndexes(result.blocks);
  const blockIndex = position === 'first' ? content[0] : content[content.length - 1];
  if (blockIndex === undefined) return undefined;
  return tableCandidateAt(result, blockIndex);
}

/** 页末表格接上下一页页首表格；需要列数一致并具备明确的跨页位置关系。 */
function canMergeTable(previous: TableCandidate, next: TableCandidate): boolean {
  // 续页可能只剩一行数据，不能要求下一页表格至少两行。
  if (previous.width !== next.width || previous.table.rows.length < 2 || next.table.rows.length < 1)
    return false;
  const bottom = previous.block.y + previous.block.h;
  const top = next.block.y;
  if (bottom < 0.62 || top > 0.38) return false;
  const repeatedHeader = repeatedHeaderRows(previous.table, next.table);
  if (repeatedHeader > 0) return repeatedHeader < next.table.rows.length;
  // 下一页没有重复表头时，要求表格确实贴近页边界，且首行不是新的表头。
  if (bottom < 0.75 || top > 0.3) return false;
  const firstRow = next.table.rows[0]!;
  return !Array.from(firstRow.cells).some((cell) => cell.tagName.toLowerCase() === 'th');
}

/** 同一页内的续表必须垂直贴近且水平范围基本重合，避免拼接两张独立表。 */
function canMergeTableInPage(previous: TableCandidate, next: TableCandidate): boolean {
  if (previous.width !== next.width || !previous.table.rows.length || !next.table.rows.length)
    return false;
  const bottom = previous.block.y + previous.block.h;
  const gap = next.block.y - bottom;
  if (gap < -0.02 || gap > 0.06) return false;
  if (Math.abs(previous.block.x - next.block.x) > 0.02) return false;
  const overlap =
    Math.min(previous.block.x + previous.block.w, next.block.x + next.block.w) -
    Math.max(previous.block.x, next.block.x);
  if (overlap <= 0 || overlap / Math.min(previous.block.w, next.block.w) < 0.8) return false;
  const repeatedHeader = repeatedHeaderRows(previous.table, next.table);
  if (repeatedHeader > 0) return repeatedHeader < next.table.rows.length;
  const firstRow = next.table.rows[0]!;
  return !Array.from(firstRow.cells).some((cell) => cell.tagName.toLowerCase() === 'th');
}

function mergedTableHtml(previous: TableCandidate, next: readonly TableCandidate[]): string {
  const merged = previous.table.cloneNode(true) as HTMLTableElement;
  const target = merged.tBodies[merged.tBodies.length - 1] ?? merged;
  for (const candidate of next) {
    const rows = Array.from(candidate.table.rows);
    const skipHeader = repeatedHeaderRows(merged, candidate.table);
    for (const row of rows.slice(skipHeader)) target.append(row.cloneNode(true));
  }
  return merged.outerHTML;
}

function replaceTable(
  result: ImageParseSdkResult,
  candidate: TableCandidate,
  html: string,
): ImageParseSdkResult {
  const delta = html.length - (candidate.range.end - candidate.range.start);
  const blocks = result.blocks.map((block, index) => {
    if (index === candidate.blockIndex)
      return {
        ...block,
        text: html,
        markdown: html,
        markdownStart: candidate.range.start,
        markdownEnd: candidate.range.start + html.length,
        ttsInvalid: true,
      };
    if (block.markdownStart === undefined || block.markdownEnd === undefined) return block;
    if (block.markdownStart >= candidate.range.end)
      return {
        ...block,
        markdownStart: block.markdownStart + delta,
        markdownEnd: block.markdownEnd + delta,
      };
    return block;
  });
  return {
    ...result,
    markdown:
      result.markdown.slice(0, candidate.range.start) +
      html +
      result.markdown.slice(candidate.range.end),
    blocks,
  };
}

/** 移除续表占位，并把后续块范围前移；不留下连续空行。 */
function removeTable(result: ImageParseSdkResult, candidate: TableCandidate): ImageParseSdkResult {
  let start = candidate.range.start;
  let end = candidate.range.end;
  if (result.markdown.slice(end, end + 2) === '\n\n') end += 2;
  else if (start >= 2 && result.markdown.slice(start - 2, start) === '\n\n') start -= 2;
  else if (result.markdown[end] === '\n') end += 1;
  else if (result.markdown[start - 1] === '\n') start -= 1;
  const markdown = result.markdown.slice(0, start) + result.markdown.slice(end);
  const delta = markdown.length - result.markdown.length;
  const blocks = result.blocks.map((block, index) => {
    if (index === candidate.blockIndex)
      return {
        ...block,
        markdown: '',
        markdownStart: undefined,
        markdownEnd: undefined,
        mergedIntoPreviousPage: true,
        ttsInvalid: true,
      };
    if (block.markdownStart === undefined || block.markdownEnd === undefined) return block;
    if (block.markdownStart >= candidate.range.end)
      return {
        ...block,
        markdownStart: block.markdownStart + delta,
        markdownEnd: block.markdownEnd + delta,
      };
    return block;
  });
  return { ...result, markdown, blocks };
}

/** 合并后的单图表格要覆盖所有原始区域，保证原图框与正文定位仍可用。 */
function expandTableBlock(
  result: ImageParseSdkResult,
  blockIndex: number,
  blocks: readonly ImageParseLayoutBlock[],
): ImageParseSdkResult {
  const regions = blocks.flatMap((block) => imageParseBlockRegions(block));
  const left = Math.min(...regions.map((region) => region.x));
  const top = Math.min(...regions.map((region) => region.y));
  const right = Math.max(...regions.map((region) => region.x + region.w));
  const bottom = Math.max(...regions.map((region) => region.y + region.h));
  return {
    ...result,
    blocks: result.blocks.map((block, index) =>
      index === blockIndex
        ? { ...block, x: left, y: top, w: right - left, h: bottom - top, regions }
        : block,
    ),
  };
}

/** 单图续表直接从版面中移除，不保留空块占位。 */
function removeTableBlock(
  result: ImageParseSdkResult,
  candidate: TableCandidate,
): ImageParseSdkResult {
  let start = candidate.range.start;
  let end = candidate.range.end;
  if (result.markdown.slice(end, end + 2) === '\n\n') end += 2;
  else if (start >= 2 && result.markdown.slice(start - 2, start) === '\n\n') start -= 2;
  else if (result.markdown[end] === '\n') end += 1;
  else if (result.markdown[start - 1] === '\n') start -= 1;
  const markdown = result.markdown.slice(0, start) + result.markdown.slice(end);
  const delta = markdown.length - result.markdown.length;
  const blocks = result.blocks
    .filter((_, index) => index !== candidate.blockIndex)
    .map((block) => {
      if (block.markdownStart === undefined || block.markdownEnd === undefined) return block;
      if (block.markdownStart >= candidate.range.end)
        return {
          ...block,
          markdownStart: block.markdownStart + delta,
          markdownEnd: block.markdownEnd + delta,
        };
      return block;
    });
  return { ...result, markdown, blocks };
}

function imageTableChains(result: ImageParseSdkResult): TableCandidate[][] {
  const content = contentBlockIndexes(result.blocks);
  const chains: TableCandidate[][] = [];
  let chain: TableCandidate[] = [];
  for (const index of content) {
    const current = tableCandidateAt(result, index);
    const previous = chain[chain.length - 1];
    if (current && previous && canMergeTableInPage(previous, current)) {
      chain.push(current);
      continue;
    }
    if (chain.length > 1) chains.push(chain);
    chain = current ? [current] : [];
  }
  if (chain.length > 1) chains.push(chain);
  return chains;
}

/** 判断单图是否存在可保守合并的相邻表格，用于决定工具栏入口是否渲染。 */
export function hasMergableImageParseTables(result: ImageParseSdkResult): boolean {
  return imageTableChains(result).length > 0;
}

/**
 * 合并同一张图片内被识别拆开的相邻表格。只处理阅读顺序连续、垂直贴近、
 * 水平范围基本重合且列数一致的表格；中间有正文或疑似新表头时保持原样。
 */
export function mergeImageParseTablesInPage(
  result: ImageParseSdkResult,
): { result: ImageParseSdkResult; count: number } | undefined {
  const chains = imageTableChains(result);
  if (!chains.length) return undefined;
  let mergedResult = result;
  let count = 0;
  for (const chain of [...chains].reverse()) {
    const root = chain[0]!;
    const html = mergedTableHtml(root, chain.slice(1));
    mergedResult = replaceTable(mergedResult, root, html);
    mergedResult = expandTableBlock(
      mergedResult,
      root.blockIndex,
      chain.map((item) => item.block),
    );
    for (let index = chain.length - 1; index >= 1; index -= 1) {
      const candidate = tableCandidateAt(mergedResult, chain[index]!.blockIndex);
      if (!candidate) return undefined;
      mergedResult = removeTableBlock(mergedResult, candidate);
    }
    count += chain.length - 1;
  }
  return { result: mergedResult, count };
}

/**
 * 自动拼接 PDF 跨页表格。只处理「上一页最后一个内容块是表格、下一页第一个内容块也是表格」
 * 的保守场景；列结构不一致、存在页间正文或表格不在页边界时保持原样。
 * @param pages 按 PDF 页码（1 起始）排列的识别结果
 * @returns 发生变化页的 0 起始页码 → 新结果
 */
export function mergeImageParseTables(
  pages: readonly { page: number; result?: ImageParseSdkResult }[],
): Map<number, ImageParseSdkResult> {
  const ordered: PageTable[] = pages
    .filter((page) => page.result)
    .map((page) => ({ page: page.page, result: page.result! }))
    .sort((left, right) => left.page - right.page);
  for (const item of ordered) {
    item.first = tableCandidate(item.result, 'first');
    item.last = tableCandidate(item.result, 'last');
  }

  const changed = new Map<number, ImageParseSdkResult>();
  let chainStart = 0;
  for (let index = 1; index <= ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const continues =
      previous?.last && current?.first && canMergeTable(previous.last, current.first);
    if (index < ordered.length && continues) continue;
    if (index - chainStart > 1) {
      const root = ordered[chainStart]!;
      const rootCandidate = root.last!;
      const continuation = ordered
        .slice(chainStart + 1, index)
        .flatMap((item) => (item.first ? [item.first] : []));
      if (continuation.length === index - chainStart - 1) {
        const html = mergedTableHtml(rootCandidate, continuation);
        changed.set(root.page - 1, replaceTable(root.result, rootCandidate, html));
        for (const item of ordered.slice(chainStart + 1, index)) {
          changed.set(item.page - 1, removeTable(item.result, item.first!));
        }
      }
    }
    chainStart = index;
  }
  return changed;
}
