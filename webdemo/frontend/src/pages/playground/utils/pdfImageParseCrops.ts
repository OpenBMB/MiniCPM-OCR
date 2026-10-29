import type { ImageParseSdkResult } from '@/api/map/imageParseSdk';
import { imageParseCrops } from './imageParseCrops';
import { renderPdfPageImage } from './pdfPageImage';

/** 从存档 PDF 重建当前页裁剪预览，仅执行本地渲染，不调用 OCR 或签链。 */
export async function rebuildPdfPageCrops(
  source: string,
  page: number,
  result: ImageParseSdkResult,
  signal: AbortSignal,
): Promise<string[]> {
  signal.throwIfAborted();
  const { loadPdfPreview } = await import('./pdfPreview');
  signal.throwIfAborted();
  const task = loadPdfPreview(source);
  let destruction: Promise<void> | undefined;
  const destroy = () => (destruction ??= task.destroy().catch(() => undefined));
  const abort = () => {
    void destroy();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const pdf = await task.promise;
    signal.throwIfAborted();
    const image = await renderPdfPageImage(pdf, page, signal);
    return await imageParseCrops(
      result.markdown,
      result.blocks,
      image,
      signal,
      result.rotation,
      { allPictures: true },
    );
  } finally {
    signal.removeEventListener('abort', abort);
    await destroy();
  }
}
