import type { ImageParseTextRange } from './imageParseBlocks';
import { imageParseBlockId } from './imageParseBlocks';
import type { ImageParseLayoutBlock } from './imageParseSample';

/** Text pattern of a page-number block; used only on semantic blocks already marked as footer, so ordinary numeric body text is not treated as a page number. */
const PAGE_NUMBER_PATTERNS = [
  /^(?:第\s*)?\d{1,4}\s*(?:页)?$/,
  /^\d{1,4}\s*\/\s*\d{1,4}$/,
  /^[-–—]\s*\d{1,4}\s*[-–—]$/,
  /^(?:page|p\.?)\s*\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$/i,
];

/** Strip common Markdown emphasis markers and decide whether a standalone piece of text is only a page number. */
export function isImageParsePageNumber(text: string): boolean {
  const plain = text
    .trim()
    .replace(/^\*\*(.*)\*\*$/s, '$1')
    .replace(/^\*(.*)\*$/s, '$1')
    .replace(/^_(.*)_$/s, '$1')
    .trim();
  if (!plain || plain.length > 24) return false;
  return PAGE_NUMBER_PATTERNS.some((pattern) => pattern.test(plain));
}

/** The editor decides display style by range; the range key is shared with pageNumberRanges. */
export function imageParseRangeKey(range: ImageParseTextRange): string {
  return `${range.start}:${range.end}`;
}

/** Only a block the service explicitly marked as footer / page number becomes a candidate; the editor confirms the actual text again. */
export function imageParsePageNumberRanges(
  blocks: readonly ImageParseLayoutBlock[],
  ranges: ReadonlyMap<string, ImageParseTextRange>,
): ReadonlySet<string> {
  const pageNumbers = new Set<string>();
  blocks.forEach((block, order) => {
    if (block.kind !== 'footer' || !isImageParsePageNumber(block.text)) return;
    const range = ranges.get(imageParseBlockId(block, order));
    if (range) pageNumbers.add(imageParseRangeKey(range));
  });
  return pageNumbers;
}
