import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

/**
 * 为进入页带可见区域的 PDF 页面绘制低分辨率缩略图，复用阅读器文档。
 * @param pdf 当前 PDF.js 文档
 * @param pageNumber 页码
 * @returns 画布引用与就绪状态
 */
export function usePdfThumbnail(pdf: PDFDocumentProxy | undefined, pageNumber: number) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [readyPage, setReadyPage] = useState<{
    document: PDFDocumentProxy;
    pageNumber: number;
  }>();
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pdf) return;
    let disposed = false;
    let started = false;
    let task: RenderTask | undefined;
    const buffer = canvas.ownerDocument.createElement('canvas');
    const render = async () => {
      if (started || disposed) return;
      started = true;
      try {
        const page = await pdf.getPage(pageNumber);
        if (disposed) return;
        const original = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({
          scale: 120 / Math.max(original.width, original.height),
        });
        buffer.width = Math.max(1, Math.ceil(viewport.width));
        buffer.height = Math.max(1, Math.ceil(viewport.height));
        task = page.render({ canvas: buffer, viewport });
        await task.promise;
        if (disposed) return;
        const context = canvas.getContext('2d');
        if (!context) return;
        canvas.width = buffer.width;
        canvas.height = buffer.height;
        context.drawImage(buffer, 0, 0);
        setReadyPage({ document: pdf, pageNumber });
      } catch {
        // 缩略图失败保留文件占位，不影响正文阅读或触发额外的文档加载。
      } finally {
        buffer.width = buffer.height = 0;
      }
    };
    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver === 'undefined') void render();
    else {
      observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer?.disconnect();
        void render();
      });
      observer.observe(canvas);
    }
    return () => {
      disposed = true;
      observer?.disconnect();
      task?.cancel();
    };
  }, [pdf, pageNumber]);
  return {
    canvasRef,
    ready: Boolean(pdf && readyPage?.document === pdf && readyPage.pageNumber === pageNumber),
  };
}
