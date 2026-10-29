import type { ImageParseLayoutBlock } from './imageParseSample';
import { imageParseBlockId, imageParseConfidence } from './imageParseBlocks';

/** 界面分流阈值，仅用于提示复核，不代表校准后的正确概率。 */
export const IMAGE_PARSE_REVIEW_THRESHOLD = 0.8;

/**
 * 原文档框色分级阈值（第一期临时标准，由平台统一配置，暂不开放用户调整）：
 * 低于 99% 使用淡灰色框，99% 及以上使用深绿色并加粗框线。
 */
export const IMAGE_PARSE_CONFIDENCE_ERROR_MAX = 0.2;
export const IMAGE_PARSE_CONFIDENCE_HIGH_MIN = 0.99;

/** 置信度色块分级；缺失或非法分数为中性色，不参与红黄绿判断。 */
export type ImageParseConfidenceLevel = 'error' | 'low' | 'high' | 'neutral';

/**
 * 按平台统一阈值给有效分数分级。
 * @param confidence 服务返回的 0–1 分数，或 null/非法值
 * @returns 色块分级：低于 20% 为 error、20%–99% 为 low、99% 及以上为 high，其余为 neutral；界面将非 high 统一渲染为淡灰色
 */
export function imageParseConfidenceLevel(confidence: number | null): ImageParseConfidenceLevel {
  if (confidence === null || !Number.isFinite(confidence) || confidence < 0 || confidence > 1)
    return 'neutral';
  if (confidence < IMAGE_PARSE_CONFIDENCE_ERROR_MAX) return 'error';
  if (confidence < IMAGE_PARSE_CONFIDENCE_HIGH_MIN) return 'low';
  return 'high';
}

/** 原图框线与分数列共用状态分级，失败优先标红，跳过保持中性。 */
export function imageParseBlockConfidenceLevel(
  block: ImageParseLayoutBlock,
): ImageParseConfidenceLevel {
  // 跨页表格合并后的 score 来自合并前半表，不能当作当前完整表格质量。
  if (block.ttsInvalid) return 'neutral';
  if (block.status === 'skipped_no_vlm') return 'neutral';
  if (block.status && block.status !== 'ok') return 'error';
  return imageParseConfidenceLevel(block.confidence);
}

/** 跳过、失败、纯图与无分数的块没有可重算的文字；旧演示允许省略状态。 */
export function imageParseBlockCanRegenerate(block: ImageParseLayoutBlock): boolean {
  return (
    !block.ttsInvalid &&
    block.confidence !== null &&
    Number.isFinite(block.confidence) &&
    !['image', 'chart', 'seal'].includes(block.kind) &&
    (!block.status || block.status === 'ok')
  );
}

/** 保留阅读顺序的有分数区块。 */
export interface ImageParseQualityItem {
  id: string;
  order: number;
  block: ImageParseLayoutBlock;
  score: string;
  suggested: boolean;
}

/** 汇总服务实际提供的有效分数；缺失与非法值不补造，0 仍是有效分数。 */
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
 * 给复核列表生成可读摘要。服务可能把 HTML 片段放在 text 或 markdown 中，
 * 列表只展示文本内容，避免把表格标签直接暴露给用户。
 *
 * 图片节点（如 `![image]()`）没有可读文本、也没有有效地址，属于无意义内容，直接丢弃；
 * 链接只保留文字，避免把 URL 当正文。清洗后为空时返回空串，由调用方决定不渲染。
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
