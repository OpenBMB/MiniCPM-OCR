import type { ImageParseLayoutBlock } from './imageParseSample';
import { imageParseBlockId, imageParseConfidence } from './imageParseBlocks';

/** UI split threshold, used only to suggest review, and not a calibrated probability of correctness. */
export const IMAGE_PARSE_REVIEW_THRESHOLD = 0.8;

/**
 * Color tiers for boxes on the original document (a temporary first-phase standard, configured by the platform, not yet open for users to adjust):
 * below 99% uses a light gray box; 99% and above uses dark green and a thicker stroke.
 */
export const IMAGE_PARSE_CONFIDENCE_ERROR_MAX = 0.2;
export const IMAGE_PARSE_CONFIDENCE_HIGH_MIN = 0.99;

/** Confidence color tiers; a missing or illegal score is a neutral color and does not take part in the red/yellow/green decision. */
export type ImageParseConfidenceLevel = 'error' | 'low' | 'high' | 'neutral';

/**
 * Tier a valid score by the platform's unified threshold.
 * @param confidence 0–1 score returned by the service, or null/an illegal value
 * @returns color tier: below 20% is error, 20%–99% is low, 99% and above is high, otherwise neutral; the UI renders anything that is not high as light gray
 */
export function imageParseConfidenceLevel(confidence: number | null): ImageParseConfidenceLevel {
  if (confidence === null || !Number.isFinite(confidence) || confidence < 0 || confidence > 1)
    return 'neutral';
  if (confidence < IMAGE_PARSE_CONFIDENCE_ERROR_MAX) return 'error';
  if (confidence < IMAGE_PARSE_CONFIDENCE_HIGH_MIN) return 'low';
  return 'high';
}

/** Original-image box strokes and the score column share status tiers; failure is marked red first, and skip stays neutral. */
export function imageParseBlockConfidenceLevel(
  block: ImageParseLayoutBlock,
): ImageParseConfidenceLevel {
  // After a cross-page table merge, score comes from the first half of the table before the merge and cannot be treated as the quality of the current full table.
  if (block.ttsInvalid) return 'neutral';
  if (block.status === 'skipped_no_vlm') return 'neutral';
  if (block.status && block.status !== 'ok') return 'error';
  return imageParseConfidenceLevel(block.confidence);
}

/** Skipped, failed, image-only, and unscored blocks have no text that can be recomputed; the old demo may omit status. */
export function imageParseBlockCanRegenerate(block: ImageParseLayoutBlock): boolean {
  return (
    !block.ttsInvalid &&
    block.confidence !== null &&
    Number.isFinite(block.confidence) &&
    !['image', 'chart', 'seal'].includes(block.kind) &&
    (!block.status || block.status === 'ok')
  );
}

/** Scored blocks kept in reading order. */
export interface ImageParseQualityItem {
  id: string;
  order: number;
  block: ImageParseLayoutBlock;
  score: string;
  suggested: boolean;
}

/** Summarize valid scores the service actually provided; missing and illegal values are not invented, and 0 is still a valid score. */
export function imageParseQuality(blocks: readonly ImageParseLayoutBlock[]) {
  const scored: ImageParseQualityItem[] = [];
  blocks.forEach((block, order) => {
    if (block.ttsInvalid) return;
    const score = imageParseConfidence(block.confidence);
    if (score === null) return;
    scored.push({
      id: imageParseBlockId(block, order),
      order: (block.order ?? order) + 1,
      block,
      score,
      suggested: block.confidence! < IMAGE_PARSE_REVIEW_THRESHOLD,
    });
  });
  return {
    scored,
    suggested: scored.filter((item) => item.suggested),
    missing: blocks.length - scored.length,
    skipped: blocks.filter((block) => block.status === 'skipped_no_vlm'),
    failed: blocks.filter(
      (block) => block.status && block.status !== 'ok' && block.status !== 'skipped_no_vlm',
    ),
  };
}

/**
 * Build a readable summary for the review list. The service may put an HTML fragment in text or markdown,
 * and the list shows only text content, so table tags are not exposed to the user directly.
 *
 * An image node (such as `![image]()`) has no readable text and no valid URL, so it is meaningless content and is dropped;
 * a link keeps only its text, so a URL is not treated as body text. When cleaning leaves it empty, return an empty string and let the caller decide not to render.
 */
export function qualityExcerpt(block: ImageParseQualityItem['block']): string {
  const source = block.text || block.markdown;
  return source
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(?:table|thead|tbody|tr|td|th)[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
