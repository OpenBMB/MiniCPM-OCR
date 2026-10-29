import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

/**
 * Draw a low-resolution thumbnail for a PDF page once it enters the visible band, reusing the reader document.
 * @param pdf current PDF.js document
 * @param pageNumber page number
 * @returns the canvas ref and the ready state
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
        // A failed thumbnail keeps the file placeholder, and does not affect body reading or trigger an extra document load.
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
