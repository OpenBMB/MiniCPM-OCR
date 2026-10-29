import type { PdfPageResult } from './pdfImageParse';

/** 将 PDF.js 与 OCR 调用异常映射为稳定的界面文案键。 */
export function pdfParseErrorKey(failure: unknown): string {
  if (!(failure instanceof Error)) return 'imageParseRequestFailed';
  if (failure.name === 'PasswordException') return 'documentPdfPassword';
  if (failure.message === 'imageParsePdfTooManyPages' || failure.message === 'documentPdfFailed')
    return failure.message;
  if (failure.message === 'imageParseSdkUnavailable') return 'documentPdfServiceUnavailable';
  if (/^imageParse[A-Z]/.test(failure.message)) return failure.message;
  return 'imageParseRequestFailed';
}

/** 统计已有结果或错误页，等待占位不参与完成度。 */
export function countCompletedPdfPages(results: Readonly<Record<number, PdfPageResult>>) {
  return Object.values(results).filter((page) => Boolean(page.result) || Boolean(page.error))
    .length;
}

/** 恢复时仅跳过已有成功结果的页；失败页仍可重新展示。 */
export function completedPdfPageIndexes(
  results: Readonly<Record<number, PdfPageResult>>,
): Set<number> {
  return new Set(
    Object.entries(results)
      .filter(([, value]) => value.result)
      .map(([key]) => Number(key)),
  );
}
