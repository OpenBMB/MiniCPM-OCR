import { mapRequest } from './request';
import type { ImageParseExampleType } from '@/pages/playground/utils/imageParseExamples';

/** One pre-captured page result for a shared example stored in the database. */
export interface ImageParseExampleCapture {
  resultIndex: number;
  sourcePage: number;
  model: string;
  capturedAt: string;
  inputSha256: string;
  response: unknown;
}

/** Every pre-captured page of one shared example. */
export interface ImageParseExample {
  type: ImageParseExampleType;
  captures: ImageParseExampleCapture[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCapture(value: unknown): value is ImageParseExampleCapture {
  return (
    isRecord(value) &&
    typeof value.resultIndex === 'number' &&
    Number.isSafeInteger(value.resultIndex) &&
    value.resultIndex >= 1 &&
    typeof value.sourcePage === 'number' &&
    Number.isSafeInteger(value.sourcePage) &&
    value.sourcePage >= 1 &&
    value.model === 'minicpm-ocr' &&
    typeof value.capturedAt === 'string' &&
    Number.isFinite(Date.parse(value.capturedAt)) &&
    typeof value.inputSha256 === 'string' &&
    /^[a-f\d]{64}$/.test(value.inputSha256) &&
    isRecord(value.response) &&
    !('map_ocr_source' in value.response)
  );
}

/**
 * Read and validate pre-captured database results; do not trigger OCR, and do not fall back to frontend demo data.
 * @param type Fixed example type
 * @param version Original-file version, so a cached result for an old image is not used
 * @param signal Abort signal used when switching example, account, or project
 * @returns Server recognition results for every page of this example
 */
export async function getImageParseExample(
  type: ImageParseExampleType,
  version: string,
  signal?: AbortSignal,
): Promise<ImageParseExample> {
  const query = new URLSearchParams({ version });
  const value = await mapRequest(`/image-parse/examples/${encodeURIComponent(type)}?${query}`, {
    signal,
  });
  if (
    !isRecord(value) ||
    value.type !== type ||
    !Array.isArray(value.captures) ||
    value.captures.length === 0 ||
    !value.captures.every(isCapture)
  )
    throw new Error('imageParseExampleInvalid');
  return { type, captures: value.captures };
}
