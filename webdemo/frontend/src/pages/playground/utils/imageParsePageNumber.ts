import type { ImageParseTextRange } from './imageParseBlocks';
import { imageParseBlockId } from './imageParseBlocks';
import type { ImageParseLayoutBlock } from './imageParseSample';

/** 页码块的文字特征；只用于已标记为 footer 的语义块，避免把普通数字正文当成页码。 */
const PAGE_NUMBER_PATTERNS = [
  /^(?:第\s*)?\d{1,4}\s*(?:页)?$/,
  /^\d{1,4}\s*\/\s*\d{1,4}$/,
  /^[-–—]\s*\d{1,4}\s*[-–—]$/,
  /^(?:page|p\.?)\s*\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$/i,
];

/** 去掉常见 Markdown 强调标记，判断一段独立文字是否只是页码。 */
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

/** 编辑器按范围判断显示样式；range key 与 pageNumberRanges 共用。 */
export function imageParseRangeKey(range: ImageParseTextRange): string {
  return `${range.start}:${range.end}`;
}

/** 只有服务明确标记为页脚 / 页码的块才进入候选，具体文字由编辑器再次确认。 */
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
