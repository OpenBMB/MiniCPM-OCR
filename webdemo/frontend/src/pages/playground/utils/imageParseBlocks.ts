import type { ImageParseLayoutBlock } from './imageParseSample';

/** Markdown 中一个块对应的原始字符范围。 */
export interface ImageParseTextRange {
  start: number;
  end: number;
}

/** 优先使用服务标识；本地样例与无标识响应使用坐标及阅读顺序保证唯一。 */
export function imageParseBlockId(block: ImageParseLayoutBlock, order: number): string {
  return block.id ?? `${order}:${block.x}:${block.y}:${block.w}:${block.h}`;
}

/** 合并块优先返回全部 regions；旧结果回落到主 bbox。 */
export function imageParseBlockRegions(block: ImageParseLayoutBlock) {
  return block.regions?.length
    ? block.regions
    : [{ x: block.x, y: block.y, w: block.w, h: block.h }];
}

/**
 * 按阅读顺序定位片段，重复文字不一律指向第一次出现的位置。
 * 原始范围由草稿的替换记录继续维护；不重新猜测修改后文字的位置。
 */
export function imageParseBlockRanges(
  markdown: string,
  blocks: readonly ImageParseLayoutBlock[],
): ReadonlyMap<string, ImageParseTextRange> {
  const ranges = new Map<string, ImageParseTextRange>();
  let cursor = 0;
  blocks.forEach((block, order) => {
    if (!block.markdown) return;
    const explicit = block.markdownStart !== undefined && block.markdownEnd !== undefined;
    const start = explicit ? block.markdownStart! : markdown.indexOf(block.markdown, cursor);
    const end = explicit ? block.markdownEnd! : start + block.markdown.length;
    if (start < 0 || end <= start || markdown.slice(start, end) !== block.markdown) return;
    ranges.set(imageParseBlockId(block, order), { start, end });
    cursor = Math.max(cursor, end);
  });
  return ranges;
}

/** 把 0–1 分数显示为整数百分比并向下取整；仅格式化显示，不修改用于复核判断的原始值。 */
export function imageParseConfidence(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value < 0 || value > 1) return null;
  const percent = Math.floor((value + Number.EPSILON) * 100);
  return `${percent}%`;
}
