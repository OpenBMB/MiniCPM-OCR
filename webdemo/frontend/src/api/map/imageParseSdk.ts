import type {
  ImageParseLayoutBlock,
  ImageParseLayoutRegion,
  ImageParseRotationInfo,
} from '@/pages/playground/utils/imageParseSample';
import type { ImageParseSource } from './imageParseSource';

/**
 * 工作台识别档位。
 * 新识别统一使用算法流水线。scored/high-precision 只为历史快照保留，
 * 不代表当前支持评分或高精度。
 */
export type ImageParseMode =
  | 'standard'
  | 'scored'
  | 'high-precision'
  | 'standard-pipeline'
  | 'seal'
  | 'kie';

/** 算法流水线档位均由 L3 代理，不依赖浏览器持有的 L2 API Key。 */
export function isImageParsePipelineMode(
  mode: ImageParseMode,
): mode is 'standard-pipeline' | 'seal' | 'kie' {
  return mode === 'standard-pipeline' || mode === 'seal' || mode === 'kie';
}

/** 印章识别只接受单张图片；关键信息抽取支持图片与 PDF 逐页链路。 */
export function isImageParsePipelineImageMode(
  mode: ImageParseMode,
): mode is 'seal' | 'kie' {
  return mode === 'seal' || mode === 'kie';
}

/** 图片、PDF 与缓存恢复共用的工作台识别默认档位。 */
export const IMAGE_PARSE_DEFAULT_MODE: ImageParseMode = 'standard';

/** 门户消费的结构化结果，由服务适配层统一生成。 */
export interface ImageParseSdkResult {
  markdown: string;
  blocks: readonly ImageParseLayoutBlock[];
  /** 本页识别的 request_id；跨页表格合并按它找回各页结果。 */
  requestId?: string;
  source?: ImageParseSource;
  /** 服务端摆正信息；缺省表示旧响应未开启旋转。 */
  rotation?: ImageParseRotationInfo;
}

/** 单块重算结果；分数必须与基础识别使用相同评分尺度。 */
export interface ImageParseRegenerateResult {
  markdown: string;
  confidence: number;
  /** v4 的实际模型轮次；存在时代表服务端已完成整次优化，不再在前端重试。 */
  roundsUsed?: number;
  text?: string;
  requestId?: string;
  sourceRequestId?: string;
  priorScore?: number;
  stopReason?: string;
  exhausted?: boolean;
}

/** 校验 SDK 返回的坐标与分数；未知分数保留 null，不在前端估算。 */
export function validateImageParseSdkResult(
  result: ImageParseSdkResult,
  options: { allowEmptyMarkdown?: boolean } = {},
): ImageParseSdkResult {
  if (
    typeof result?.markdown !== 'string' ||
    (!options.allowEmptyMarkdown && !result.markdown.trim())
  ) {
    throw new Error('imageParseEmptyResponse');
  }
  if (!Array.isArray(result.blocks)) throw new Error('imageParseInvalidResult');
  const ids = new Set<string>();
  for (const block of result.blocks) {
    if (
      !block ||
      ![block.x, block.y, block.w, block.h].every(Number.isFinite) ||
      block.x < 0 ||
      block.y < 0 ||
      block.w <= 0 ||
      block.h <= 0 ||
      block.x + block.w > 1.000001 ||
      block.y + block.h > 1.000001 ||
      typeof block.text !== 'string' ||
      typeof block.markdown !== 'string' ||
      (block.confidence !== null &&
        (!Number.isFinite(block.confidence) || block.confidence < 0 || block.confidence > 1))
    ) {
      throw new Error('imageParseInvalidResult');
    }
    if (block.regions !== undefined && !sanitizeImageParseRegions(block.regions)) {
      throw new Error('imageParseInvalidResult');
    }
    if (block.ttsInvalid !== undefined && typeof block.ttsInvalid !== 'boolean') {
      throw new Error('imageParseInvalidResult');
    }
    if (block.id !== undefined) {
      if (typeof block.id !== 'string' || !block.id || ids.has(block.id)) {
        throw new Error('imageParseInvalidResult');
      }
      ids.add(block.id);
    }
    if (block.markdownStart !== undefined || block.markdownEnd !== undefined) {
      if (
        !Number.isInteger(block.markdownStart) ||
        !Number.isInteger(block.markdownEnd) ||
        block.markdownStart! < 0 ||
        block.markdownEnd! <= block.markdownStart! ||
        block.markdownEnd! > result.markdown.length ||
        result.markdown.slice(block.markdownStart, block.markdownEnd) !== block.markdown
      ) {
        throw new Error('imageParseInvalidResult');
      }
    }
  }
  if (result.rotation !== undefined && !sanitizeImageParseRotation(result.rotation)) {
    throw new Error('imageParseInvalidResult');
  }
  return result;
}

/** 清洗服务端旋转元数据；缺失或非法时返回 null，不伪造摆正角度。 */
export function sanitizeImageParseRotation(value: unknown): ImageParseRotationInfo | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rotation = value as Record<string, unknown>;
  const numbers = [rotation.totalAngle, rotation.orientationAngle, rotation.deskewAngle];
  const isNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
  // 预测字段只在摆正真正跑过时才有；未启用 / gated 时后端给 null。
  const optional = (value: unknown) => value === null || isNumber(value);
  if (
    typeof rotation.enabled !== 'boolean' ||
    typeof rotation.applied !== 'boolean' ||
    !numbers.every(isNumber) ||
    !optional(rotation.predictedAngle) ||
    !optional(rotation.predictedScore) ||
    (rotation.applied && (!isNumber(rotation.predictedAngle) || !isNumber(rotation.predictedScore))) ||
    (isNumber(rotation.predictedScore) &&
      ((rotation.predictedScore as number) < 0 || (rotation.predictedScore as number) > 1)) ||
    (rotation.confirmed !== null && typeof rotation.confirmed !== 'boolean') ||
    (rotation.skippedReason !== null && typeof rotation.skippedReason !== 'string')
  )
    return null;
  return {
    enabled: rotation.enabled,
    applied: rotation.applied,
    totalAngle: rotation.totalAngle as number,
    predictedAngle: rotation.predictedAngle as number | null,
    predictedScore: rotation.predictedScore as number | null,
    confirmed: rotation.confirmed as boolean | null,
    orientationAngle: rotation.orientationAngle as number,
    deskewAngle: rotation.deskewAngle as number,
    skippedReason: rotation.skippedReason as string | null,
  };
}

/** 清洗归一化多区域；非法区域返回 null，避免合并块只画出错误局部。 */
export function sanitizeImageParseRegions(
  value: unknown,
): readonly ImageParseLayoutRegion[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const regions: ImageParseLayoutRegion[] = [];
  for (const region of value) {
    if (
      !region ||
      typeof region !== 'object' ||
      Array.isArray(region) ||
      ![region.x, region.y, region.w, region.h].every(
        (value) => typeof value === 'number' && Number.isFinite(value),
      ) ||
      region.x < 0 ||
      region.y < 0 ||
      region.w <= 0 ||
      region.h <= 0 ||
      region.x + region.w > 1.000001 ||
      region.y + region.h > 1.000001
    )
      return null;
    regions.push({ x: region.x, y: region.y, w: region.w, h: region.h });
  }
  return regions;
}
