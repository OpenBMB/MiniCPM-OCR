import { act, render, waitFor } from '@testing-library/react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { usePdfThumbnail } from '../usePdfThumbnail';

function Thumbnail({ pdf, page }: { pdf: PDFDocumentProxy; page: number }) {
  const { canvasRef, ready } = usePdfThumbnail(pdf, page);
  return <canvas ref={canvasRef} data-ready={ready} />;
}

function createPdf(promise = Promise.resolve()) {
  const cancel = vi.fn();
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({
      width: 600 * scale,
      height: 800 * scale,
    }),
    render: vi.fn((_options: { canvas: HTMLCanvasElement }) => ({ promise, cancel })),
  };
  const getPage = vi.fn(async () => page);
  return { pdf: { getPage } as unknown as PDFDocumentProxy, getPage, page, cancel };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PDF 页面缩略图', () => {
  it('仅进入可见区域后绘制，使用独立画布并提交真实像素', async () => {
    let visible!: IntersectionObserverCallback;
    const disconnect = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          visible = callback;
        }
        observe = vi.fn();
        disconnect = disconnect;
      },
    );
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    const { pdf, getPage, page } = createPdf();
    const { container } = render(<Thumbnail pdf={pdf} page={2} />);
    expect(getPage).not.toHaveBeenCalled();
    act(() =>
      visible(
        [{ isIntersecting: true }] as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      ),
    );
    await waitFor(() =>
      expect(container.querySelector('canvas')).toHaveAttribute('data-ready', 'true'),
    );
    expect(getPage).toHaveBeenCalledExactlyOnceWith(2);
    const canvas = container.querySelector('canvas')!;
    expect(page.render.mock.calls[0]?.[0]).toMatchObject({ canvas: expect.any(HTMLCanvasElement) });
    expect(drawImage).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(90);
    expect(canvas.height).toBe(120);
    expect(disconnect).toHaveBeenCalled();
  });

  it('离开文档时取消未完成渲染，拒绝旧任务回写', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const { pdf, page, cancel } = createPdf(pending);
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    const { unmount } = render(<Thumbnail pdf={pdf} page={1} />);
    await waitFor(() => expect(page.render).toHaveBeenCalledOnce());
    unmount();
    expect(cancel).toHaveBeenCalledOnce();
    await act(async () => finish());
    expect(drawImage).not.toHaveBeenCalled();
  });
});
