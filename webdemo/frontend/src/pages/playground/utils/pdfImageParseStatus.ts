import type { PdfPageResult } from './pdfImageParse';

/** Map PDF.js and OCR call failures to a stable UI copy key. */
export function pdfParseErrorKey(failure: unknown): string {
  if (!(failure instanceof Error)) return 'imageParseRequestFailed';
  if (failure.name === 'PasswordException') return 'documentPdfPassword';
  if (failure.message === 'imageParsePdfTooManyPages' || failure.message === 'documentPdfFailed')
    return failure.message;
  if (failure.message === 'imageParseSdkUnavailable') return 'documentPdfServiceUnavailable';
  if (/^imageParse[A-Z]/.test(failure.message)) return failure.message;
  return 'imageParseRequestFailed';
}

/** Count pages that already have a result or an error; a waiting placeholder does not count toward completion. */
export function countCompletedPdfPages(results: Readonly<Record<number, PdfPageResult>>) {
  return Object.values(results).filter((page) => Boolean(page.result) || Boolean(page.error))
    .length;
}

/** On restore, skip only pages that already have a successful result; failed pages can still be shown again. */
export function completedPdfPageIndexes(
  results: Readonly<Record<number, PdfPageResult>>,
): Set<number> {
  return new Set(
    Object.entries(results)
      .filter(([, value]) => value.result)
      .map(([key]) => Number(key)),
  );
}
