import type { ImageParseSdkResult } from '@/api/map/imageParseSdk';

import {
  imageParseBlockId,
  imageParseBlockRanges,
  type ImageParseTextRange,
} from './imageParseBlocks';
import { imageParseAllCropBlocks, isImageParseDisplayTextBlock } from './imageParseCrops';
import type { ImageParseLayoutBlock } from './imageParseSample';

const IMAGE_PLACEHOLDER = '![image]()';

function shouldShowText(
  block: ImageParseLayoutBlock,
  showSealText: boolean,
  showChartText: boolean,
): boolean {
  if (block.kind === 'seal') return showSealText;
  if (block.kind === 'chart') return showChartText;
  return true;
}

function blockRange(
  markdown: string,
  block: ImageParseLayoutBlock,
  index: number,
  ranges?: ReadonlyMap<string, ImageParseTextRange>,
  inferred?: ReadonlyMap<string, ImageParseTextRange>,
): ImageParseTextRange | undefined {
  return (
    ranges?.get(imageParseBlockId(block, index)) ??
    inferred?.get(imageParseBlockId(block, index)) ??
    (block.markdownStart !== undefined && block.markdownEnd !== undefined
      ? { start: block.markdownStart, end: block.markdownEnd }
      : undefined)
  );
}

/**
 * Turn a raw OCR result into an image/text display result; when seal or chart text is off, replace only the matching body text.
 * @param result raw recognition result, or the result after the user edited it
 * @param showSealText whether to show seal recognition text
 * @param showChartText whether to show chart recognition text
 * @param ranges block ranges that are still valid after the user edited
 * @returns a derived result for preview only; the raw recognition result is not modified
 */
export function imageParseSealDisplayResult(
  result: Pick<ImageParseSdkResult, 'markdown' | 'blocks'> &
    Partial<Pick<ImageParseSdkResult, 'requestId' | 'source' | 'rotation'>>,
  showSealText: boolean,
  showChartTextOrRanges: boolean | ReadonlyMap<string, ImageParseTextRange> = true,
  ranges?: ReadonlyMap<string, ImageParseTextRange>,
): ImageParseSdkResult {
  const showChartText = typeof showChartTextOrRanges === 'boolean' ? showChartTextOrRanges : true;
  const effectiveRanges =
    typeof showChartTextOrRanges === 'boolean' ? ranges : showChartTextOrRanges;
  const inferred = imageParseBlockRanges(result.markdown, result.blocks);
  const entries = result.blocks
    .map((block, index) => ({
      block,
      index,
      range: blockRange(result.markdown, block, index, effectiveRanges, inferred),
    }))
    .filter((entry): entry is typeof entry & { range: ImageParseTextRange } =>
      Boolean(
        entry.range &&
        entry.range.start >= 0 &&
        entry.range.end > entry.range.start &&
        entry.range.end <= result.markdown.length,
      ),
    )
    .sort((left, right) => left.range.start - right.range.start);

  let markdown = '';
  let cursor = 0;
  const mapped = new Map<number, ImageParseTextRange>();
  for (const entry of entries) {
    if (entry.range.start < cursor) continue;
    markdown += result.markdown.slice(cursor, entry.range.start);
    const start = markdown.length;
    const replacement =
      isImageParseDisplayTextBlock(entry.block) &&
      !shouldShowText(entry.block, showSealText, showChartText)
        ? IMAGE_PLACEHOLDER
        : result.markdown.slice(entry.range.start, entry.range.end);
    markdown += replacement;
    mapped.set(entry.index, { start, end: markdown.length });
    cursor = entry.range.end;
  }
  markdown += result.markdown.slice(cursor);

  const blocks = result.blocks.map((block, index) => {
    const range = mapped.get(index);
    if (!range) return block;
    return {
      ...block,
      markdown: markdown.slice(range.start, range.end),
      markdownStart: range.start,
      markdownEnd: range.end,
    };
  });
  return {
    ...result,
    markdown,
    blocks,
  };
}

/**
 * Filter already generated crops by the current seal/chart display mode; the crop array is cached in the order of every image block.
 * @param blocks layout blocks used by the current preview
 * @param crops crops generated for every image block
 * @param showSealText whether to show seal recognition text
 * @param showChartText whether to show chart recognition text
 * @returns crops in one-to-one correspondence with the current Markdown placeholders
 */
export function imageParseSealDisplayCrops(
  blocks: readonly ImageParseLayoutBlock[],
  crops: readonly string[] = [],
  showSealText: boolean,
  showChartText = true,
): readonly string[] {
  if (!crops.length) return [];
  const eligible = imageParseAllCropBlocks(blocks);
  if (eligible.length !== crops.length) return [];
  if (!showSealText) return crops;
  return crops.filter(
    (_, index) =>
      !isImageParseDisplayTextBlock(eligible[index]!) ||
      !shouldShowText(eligible[index]!, showSealText, showChartText),
  );
}
