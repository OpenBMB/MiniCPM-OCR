import type { PDFDocumentProxy } from 'pdfjs-dist';

/** 按 OCR 固定倍率生成本地页图，取消及完成后释放画布与页面资源。 */
export async function renderPdfPageImage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  const page = await pdf.getPage(pageNumber);
  const canvas = document.createElement('canvas');
  try {
    signal.throwIfAborted();
    const viewport = page.getViewport({ scale: 2 });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('documentPdfFailed');
    const render = page.render({ canvas, canvasContext: context, viewport });
    const abort = () => render.cancel();
    signal.addEventListener('abort', abort, { once: true });
    try {
      await render.promise;
      signal.throwIfAborted();
      return await canvasToDataUrl(canvas, signal);
    } finally {
      signal.removeEventListener('abort', abort);
    }
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();
  }
}

/** 异步编码 PNG；避免每页 toDataURL 在主线程同步压缩造成滚动卡顿。 */
function canvasToDataUrl(canvas: HTMLCanvasElement, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Render cancelled', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    canvas.toBlob((blob) => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) return;
      if (!blob) {
        reject(new Error('documentPdfFailed'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('documentPdfFailed'));
      reader.readAsDataURL(blob);
    }, 'image/png');
  });
}
