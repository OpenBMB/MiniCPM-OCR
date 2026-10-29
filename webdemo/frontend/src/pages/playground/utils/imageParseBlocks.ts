import type { ImageParseLayoutBlock } from './imageParseSample';

/** Original character range in Markdown that corresponds to one block. */
export interface ImageParseTextRange {
  start: number;
  end: number;
}

/** Prefer the service id; local samples and responses with no id use coordinates plus reading order to stay unique. */
export function imageParseBlockId(block: ImageParseLayoutBlock, order: number): string {
  return block.id ?? `${order}:${block.x}:${block.y}:${block.w}:${block.h}`;
}

/** A merged block prefers to return every region; an old result falls back to the primary bbox. */
export function imageParseBlockRegions(block: ImageParseLayoutBlock) {
  return block.regions?.length
    ? block.regions
    : [{ x: block.x, y: block.y, w: block.w, h: block.h }];
}

/**
 * Locate a fragment in reading order; repeated text does not always point at the first occurrence.
 * The original range continues to be maintained by the draft's replacement record; do not guess the position of edited text again.
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

/** Show a 0–1 score as an integer percentage, rounded down; display formatting only, and do not modify the raw value used for review decisions. */
export function imageParseConfidence(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value < 0 || value > 1) return null;
  const percent = Math.floor((value + Number.EPSILON) * 100);
  return `${percent}%`;
}
