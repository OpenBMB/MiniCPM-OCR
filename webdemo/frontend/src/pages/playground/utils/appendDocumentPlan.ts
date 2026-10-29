/** 追加页面的选择规则，以及新页接上后要保留的识别结果。不读取文件内容。 */
import type { ImageParseSdkResult } from '@/api/map/imageParseSdk';

import { documentFileError, normalizeDocumentFile } from './documentUpload';
import type { PdfImageParseSnapshot } from './imageParseHistoryTypes';
import type { PdfPageResult } from './pdfImageParse';

/**
 * 校验一次追加选择：支持多张图片或一份 PDF，不允许混选或多份 PDF。
 * @param incoming 文件选择器或拖放得到的文件列表
 * @returns 稳定的翻译键；选择合法时返回 undefined
 */
export function appendSelectionError(
  incoming: FileList | readonly File[],
): string | undefined {
  const files = Array.from(incoming, normalizeDocumentFile);
  if (!files.length) return 'documentEmptyFile';
  if (files.length > 1 && files.some((file) => file.type === 'application/pdf')) {
    return 'documentOnePdf';
  }
  for (const file of files) {
    const error = documentFileError(file);
    if (error) return error;
  }
  return undefined;
}

/**
 * 保留旧页结果，并把阅读位置停在第一张新页。
 * @param previousPages 追加前的页数
 * @param totalPages 追加后的页数
 * @param kept 旧页识别结果；没有结果的旧页会在续跑时重新识别
 * @returns 可直接交给 PDF 解析状态恢复的快照
 */
export function appendedPdfSnapshot(
  previousPages: number,
  totalPages: number,
  kept: Record<number, PdfPageResult> | undefined,
): PdfImageParseSnapshot {
  const results: Record<number, PdfPageResult> = {};
  for (const [key, value] of Object.entries(kept ?? {})) {
    const page = Number(key);
    if (page >= 1 && page <= previousPages && value?.result) results[page] = value;
  }
  return {
    page: Math.min(totalPages, previousPages + 1),
    pages: totalPages,
    results,
  };
}

/**
 * 单图文档追加时，把已经识别完的这一页当成新 PDF 的第 1 页。
 * @param page 当前单图识别结果
 * @returns 可保留的页结果；空结果返回 undefined
 */
export function imagePageResult(page: {
  markdown: string;
  blocks: ImageParseSdkResult['blocks'];
  source?: ImageParseSdkResult['source'];
  rotation?: ImageParseSdkResult['rotation'];
  requestId?: string;
}): Record<number, PdfPageResult> | undefined {
  if (!page.markdown && page.blocks.length === 0) return undefined;
  return {
    1: {
      result: {
        markdown: page.markdown,
        blocks: page.blocks,
        ...(page.source ? { source: page.source } : {}),
        ...(page.rotation ? { rotation: page.rotation } : {}),
        ...(page.requestId ? { requestId: page.requestId } : {}),
      },
    },
  };
}
