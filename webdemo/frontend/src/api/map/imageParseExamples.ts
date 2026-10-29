import { mapRequest } from './request';
import type { ImageParseExampleType } from '@/pages/playground/utils/imageParseExamples';

/** 数据库预采集的共享案例单页结果。 */
export interface ImageParseExampleCapture {
  resultIndex: number;
  sourcePage: number;
  model: string;
  capturedAt: string;
  inputSha256: string;
  response: unknown;
}

/** 单个共享案例的全部预采集页。 */
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
 * 读取并校验数据库预采集结果；不触发 OCR，也不回退为前端演示数据。
 * @param type 固定案例类型
 * @param version 原件版本，避免使用旧图的缓存结果
 * @param signal 切换案例、账号或项目时的取消信号
 * @returns 该案例全部页的服务端识别结果
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
