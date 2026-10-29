import type { ImageParseSdkResult } from '@/api/map/imageParseSdk';

import { imageParseBlockId } from './imageParseBlocks';
import {
  composeImageParseBlockMarkdown,
  isImageParseHeaderFooterBlock,
} from './imageParseBlockMarkdown';
import type { ImageParseLayoutBlock } from './imageParseSample';

const stableCache = new WeakMap<ImageParseSdkResult, ImageParseSdkResult>();

/**
 * Fill in a stable id based on original order for blocks that lack a server id.
 * Filtering headers and footers changes array indexes; fixing the id first lets selection and scroll anchors survive the toggle.
 */
export function stabilizeImageParseResult(result: ImageParseSdkResult): ImageParseSdkResult {
  if (result.blocks.every((block) => block.id)) return result;
  const cached = stableCache.get(result);
  if (cached) return cached;
  const stable: ImageParseSdkResult = {
    ...result,
    blocks: result.blocks.map((block, index) =>
      block.id ? block : { ...block, id: imageParseBlockId(block, index) },
    ),
  };
  stableCache.set(result, stable);
  return stable;
}

/** Header, footer, and page number (page numbers are grouped into footer in blockKind). */
export function isImageParseHeaderFooter(block: ImageParseLayoutBlock): boolean {
  return isImageParseHeaderFooterBlock(block);
}

/**
 * When header / footer / page number are turned off, skip those kinds and generate again block by block.
 * Start and end positions of the remaining blocks shift with the new body; when nothing can be removed, return the same object unchanged.
 */
export function hideImageParseHeaderFooter(result: ImageParseSdkResult): ImageParseSdkResult {
  const stable = stabilizeImageParseResult(result);
  if (!stable.blocks.some(isImageParseHeaderFooter)) return stable;
  const composed = composeImageParseBlockMarkdown(stable.blocks, { omitHeaderFooter: true });
  return { ...stable, markdown: composed.markdown, blocks: composed.blocks };
}
