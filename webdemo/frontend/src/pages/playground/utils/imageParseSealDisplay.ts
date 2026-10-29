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
 * 将原始 OCR 结果转换为图片/文字展示结果；关闭印章或图表文字时只替换对应正文。
 * @param result 原始识别结果或用户编辑后的结果
 * @param showSealText 是否展示印章识别文字
 * @param showChartText 是否展示图表识别文字
 * @param ranges 用户编辑后仍有效的块范围
 * @returns 仅用于预览的派生结果，不修改原始识别结果
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
 * 按当前印章/图表展示模式筛选已生成的裁图；裁图数组按全部图片块顺序缓存。
 * @param blocks 当前预览使用的版面块
 * @param crops 按全部图片块生成的裁图
 * @param showSealText 是否展示印章识别文字
 * @param showChartText 是否展示图表识别文字
 * @returns 与当前 Markdown 占位符一一对应的裁图
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
