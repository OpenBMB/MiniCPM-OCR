import type { ImageParseSdkResult } from '@/api/map/imageParseSdk';

import { imageParseBlockId } from './imageParseBlocks';
import {
  composeImageParseBlockMarkdown,
  isImageParseHeaderFooterBlock,
} from './imageParseBlockMarkdown';
import type { ImageParseLayoutBlock } from './imageParseSample';

const stableCache = new WeakMap<ImageParseSdkResult, ImageParseSdkResult>();

/**
 * 给缺少服务端 id 的块补上基于原始顺序的稳定 id。
 * 过滤页眉页脚会改变数组下标，提前固定 id 才能让选中态和滚动锚点跨开关保持。
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

/** 页眉、页脚与页码（页码在 blockKind 里归入 footer）。 */
export function isImageParseHeaderFooter(block: ImageParseLayoutBlock): boolean {
  return isImageParseHeaderFooterBlock(block);
}

/**
 * 关掉页眉 / 页脚 / 页码时，跳过这几类再按块生成一遍。
 * 其余块的起止位置随新正文后移；没有可去的块时原样返回同一对象。
 */
export function hideImageParseHeaderFooter(result: ImageParseSdkResult): ImageParseSdkResult {
  const stable = stabilizeImageParseResult(result);
  if (!stable.blocks.some(isImageParseHeaderFooter)) return stable;
  const composed = composeImageParseBlockMarkdown(stable.blocks, { omitHeaderFooter: true });
  return { ...stable, markdown: composed.markdown, blocks: composed.blocks };
}
