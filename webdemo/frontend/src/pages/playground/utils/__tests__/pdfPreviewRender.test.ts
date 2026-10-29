import type { PDFDocumentProxy } from 'pdfjs-dist';
import { describe, expect, it, vi } from 'vitest';

import { createPdfPageRenderTask, measurePdfPageGeometries } from '../pdfPreviewRender';
import { clearPdfPreviewFrames } from '../pdfPreviewFrameCache';

function createPage() {
  return {
    rotate: 0,
    cleanup: vi.fn(),
    getViewport: ({ scale, rotation }: { scale: number; rotation: number }) => ({
      scale,
      width: (rotation % 180 ? 800 : 600) * scale,
      height: (rotation % 180 ? 600 : 800) * scale,
    }),
    render: vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() }),
  };
}

describe('PDF render task lifecycle', () => {
  it('should measure unrotated dimensions and preserve intrinsic rotation separately', async () => {
    const page = {
      ...createPage(),
      rotate: 90,
      getViewport: ({ scale, rotation = 90 }: { scale: number; rotation?: number }) => ({
        scale,
        width: (rotation % 180 ? 800 : 600) * scale,
        height: (rotation % 180 ? 600 : 800) * scale,
      }),
    };
    const document = {
      numPages: 1,
      getPage: vi.fn().mockResolvedValue(page),
    } as unknown as PDFDocumentProxy;
    const initial = vi.fn();
    const task = measurePdfPageGeometries({
      document,
      anchorPage: 1,
      onInitial: initial,
      onUpdate: vi.fn(),
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(initial).toHaveBeenCalledWith([
      { pageNumber: 1, width: 600, height: 800, rotation: 90 },
    ]);
    task.cancel();
  });

  it('should not start rendering if cancelled while waiting for the page', async () => {
    const page = createPage();
    let resolve!: (value: typeof page) => void;
    const document = {
      getPage: () => new Promise<typeof page>((done) => (resolve = done)),
    } as unknown as PDFDocumentProxy;
    const task = createPdfPageRenderTask(
      document,
      1,
      {
        geometry: { pageNumber: 1, width: 600, height: 800, rotation: 0 },
        availableWidth: 600,
        scale: 1,
        rotation: 0,
        cacheKey: 'example',
      },
      window.document.createElement('canvas'),
    );
    task.cancel();
    resolve(page);
    await expect(task.promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(page.render).not.toHaveBeenCalled();
  });

  it('should fit the rotated page width instead of overflowing its skeleton', async () => {
    const page = createPage();
    const document = {
      getPage: vi.fn().mockResolvedValue(page),
    } as unknown as PDFDocumentProxy;
    const task = createPdfPageRenderTask(
      document,
      1,
      {
        geometry: { pageNumber: 1, width: 600, height: 800, rotation: 0 },
        availableWidth: 600,
        scale: 1,
        rotation: 90,
      },
      window.document.createElement('canvas'),
    );
    const frame = await task.promise;
    expect(frame.width).toBe(600);
    expect(frame.height).toBe(450);
  });

  it('should reuse completed page pixels after switching documents instead of rendering again', async () => {
    const drawImage = vi.fn();
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    try {
      const page = createPage();
      const document = {
        getPage: vi.fn().mockResolvedValue(page),
      } as unknown as PDFDocumentProxy;
      const options = {
        geometry: { pageNumber: 1, width: 600, height: 800, rotation: 0 },
        availableWidth: 600,
        scale: 1,
        rotation: 0,
        cacheKey: 'example',
      };
      const first = await createPdfPageRenderTask(
        document,
        1,
        options,
        window.document.createElement('canvas'),
      ).promise;
      first.buffer.width = first.buffer.height = 0;
      const restored = await createPdfPageRenderTask(
        document,
        1,
        options,
        window.document.createElement('canvas'),
      ).promise;

      expect(page.render).toHaveBeenCalledOnce();
      expect(restored.width).toBe(600);
      expect(restored.buffer.width).toBeGreaterThan(0);
      expect(drawImage).toHaveBeenCalled();

      await createPdfPageRenderTask(
        document,
        1,
        { ...options, rotation: 90 },
        window.document.createElement('canvas'),
      ).promise;
      expect(page.render).toHaveBeenCalledTimes(2);
      clearPdfPreviewFrames(document);
      await createPdfPageRenderTask(document, 1, options, window.document.createElement('canvas'))
        .promise;
      expect(page.render).toHaveBeenCalledTimes(3);
    } finally {
      context.mockRestore();
    }
  });
});
