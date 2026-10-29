import type { PDFDocumentProxy } from 'pdfjs-dist';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPdfPageImage } from '../pdfPageImage';

const mocks = vi.hoisted(() => ({
  viewport: vi.fn(),
  render: vi.fn(),
  cleanup: vi.fn(),
  cancel: vi.fn(),
}));
const pdf = {
  getPage: vi.fn().mockImplementation(async () => ({
    getViewport: mocks.viewport,
    render: mocks.render,
    cleanup: mocks.cleanup,
  })),
} as unknown as PDFDocumentProxy;

describe('PDF 本地页图渲染与清理', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.viewport.mockReset().mockReturnValue({ width: 400, height: 600 });
    mocks.cleanup.mockReset();
    mocks.cancel.mockReset();
    mocks.render.mockReset().mockReturnValue({ promise: Promise.resolve(), cancel: mocks.cancel });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      {} as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback) {
      callback(new Blob(['Y'], { type: 'image/png' }));
      return undefined;
    });
  });

  it('固定 scale=2，生成页图后释放画布和页面', async () => {
    expect(await renderPdfPageImage(pdf, 2, new AbortController().signal)).toBe(
      'data:image/png;base64,WQ==',
    );
    expect(pdf.getPage).toHaveBeenCalledWith(2);
    expect(mocks.viewport).toHaveBeenCalledWith({ scale: 2 });
    const canvas = mocks.render.mock.lastCall?.[0].canvas as HTMLCanvasElement;
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(mocks.cleanup).toHaveBeenCalledOnce();
  });

  it('渲染过程中取消则停止 RenderTask，并清理画布与页面', async () => {
    let reject!: (error: Error) => void;
    mocks.render.mockReturnValue({
      promise: new Promise((_, fail) => {
        reject = fail;
      }),
      cancel: mocks.cancel.mockImplementation(() => reject(new Error('cancelled'))),
    });
    const controller = new AbortController();
    const pending = renderPdfPageImage(pdf, 2, controller.signal);
    await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
    controller.abort();
    await expect(pending).rejects.toThrow('cancelled');
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(mocks.cleanup).toHaveBeenCalledOnce();
    expect(mocks.render.mock.lastCall?.[0].canvas.width).toBe(0);
  });
});
