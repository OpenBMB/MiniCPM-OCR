import type {
  ImageParseLayoutBlock,
  ImageParseLayoutRegion,
  ImageParseRotationInfo,
} from '@/pages/playground/utils/imageParseSample';
import type { ImageParseSource } from './imageParseSource';

/**
 * Workbench recognition tier.
 * New recognition always uses the algorithm pipeline. scored/high-precision are kept only for historical snapshots,
 * and do not mean scoring or high precision is supported now.
 */
export type ImageParseMode =
  | 'standard'
  | 'scored'
  | 'high-precision'
  | 'standard-pipeline'
  | 'seal'
  | 'kie';

/** Algorithm pipeline tiers are all proxied by L3 and do not depend on an L2 API Key held in the browser. */
export function isImageParsePipelineMode(
  mode: ImageParseMode,
): mode is 'standard-pipeline' | 'seal' | 'kie' {
  return mode === 'standard-pipeline' || mode === 'seal' || mode === 'kie';
}

/** Seal recognition accepts only a single image; key information extraction supports image and per-page PDF paths. */
export function isImageParsePipelineImageMode(
  mode: ImageParseMode,
): mode is 'seal' | 'kie' {
  return mode === 'seal' || mode === 'kie';
}

/** Default workbench recognition tier shared by images, PDFs, and cache restore. */
export const IMAGE_PARSE_DEFAULT_MODE: ImageParseMode = 'standard';

/** Structured result consumed by the portal, produced uniformly by the service adapter. */
export interface ImageParseSdkResult {
  markdown: string;
  blocks: readonly ImageParseLayoutBlock[];
  /** request_id of this page’s recognition; cross-page table merge uses it to find each page’s result. */
  requestId?: string;
  source?: ImageParseSource;
  /** Server rotation-adaptation info; when absent, the old response did not enable rotation. */
  rotation?: ImageParseRotationInfo;
}

/** Single-block recompute result; the score must use the same scale as the base recognition. */
export interface ImageParseRegenerateResult {
  markdown: string;
  confidence: number;
  /** Actual model rounds for v4; when present, the server has finished the whole optimization and the frontend does not retry. */
  roundsUsed?: number;
  text?: string;
  requestId?: string;
  sourceRequestId?: string;
  priorScore?: number;
  stopReason?: string;
  exhausted?: boolean;
}

/** Validate coordinates and scores returned by the SDK; keep unknown scores as null and do not estimate them on the frontend. */
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

/** Sanitize server rotation metadata; return null when it is missing or invalid, and do not fabricate a rotation-adaptation angle. */
export function sanitizeImageParseRotation(value: unknown): ImageParseRotationInfo | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rotation = value as Record<string, unknown>;
  const numbers = [rotation.totalAngle, rotation.orientationAngle, rotation.deskewAngle];
  const isNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
  // Predicted fields are present only when rotation adaptation actually ran; the backend sends null when it is disabled or gated.
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

/** Sanitize normalized multi-regions; return null for an invalid region so a merged block does not draw only a wrong fragment. */
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
