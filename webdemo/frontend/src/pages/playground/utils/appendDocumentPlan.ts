/** Selection rules for appending pages, and which recognition results to keep after the new pages are attached. Does not read file contents. */
import type { ImageParseSdkResult } from '@/api/map/imageParseSdk';

import { documentFileError, normalizeDocumentFile } from './documentUpload';
import type { PdfImageParseSnapshot } from './imageParseHistoryTypes';
import type { PdfPageResult } from './pdfImageParse';

/**
 * Validate one append selection: several images or one PDF are allowed; mixed selections and multiple PDFs are not.
 * @param incoming file list from the picker or a drop
 * @returns a stable translation key; undefined when the selection is valid
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
 * Keep the old page results and leave the reading position on the first new page.
 * @param previousPages page count before the append
 * @param totalPages page count after the append
 * @param kept recognition results for the old pages; old pages without a result are recognized again when the run continues
 * @returns a snapshot that can be handed straight to PDF parse-state restore
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
 * When appending to a single-image document, treat this already-recognized page as page 1 of the new PDF.
 * @param page current single-image recognition result
 * @returns a page result that can be kept; undefined when the result is empty
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
