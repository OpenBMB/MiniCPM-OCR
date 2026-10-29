import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPdfPreview } from '../pdfPreview';
import { IMAGE_PARSE_SHARED_EXAMPLES } from '../imageParseExamples';

const mocks = vi.hoisted(() => ({ getDocument: vi.fn() }));

vi.mock('pdfjs-dist', () => ({
  getDocument: mocks.getDocument,
  GlobalWorkerOptions: { workerSrc: '' },
}));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/pdf.worker.js' }));

describe('PDF 原文加载任务缓存', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.getDocument.mockReset();
  });

  afterEach(async () => {
    await vi.advanceTimersByTimeAsync(300_001);
    vi.useRealTimers();
  });

  it('解析失败后下一次读取同一 PDF 创建新任务，不复用失败结果', async () => {
    const failedTask = {
      promise: Promise.reject(new Error('invalid pdf')),
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    const nextTask = {
      promise: Promise.resolve({ numPages: 1 }),
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    mocks.getDocument.mockReturnValueOnce(failedTask).mockReturnValue(nextTask);

    const first = loadPdfPreview('/failed.pdf');
    await expect(first.promise).rejects.toThrow('invalid pdf');
    const second = loadPdfPreview('/failed.pdf');
    expect(second.promise).not.toBe(first.promise);
    expect(mocks.getDocument).toHaveBeenCalledTimes(2);
    const third = loadPdfPreview('/failed.pdf');
    await first.destroy();
    await vi.advanceTimersByTimeAsync(30_001);
    const fourth = loadPdfPreview('/failed.pdf');
    expect(mocks.getDocument).toHaveBeenCalledTimes(2);
    expect(fourth.promise).toBe(second.promise);
    expect(fourth.promise).toBe(third.promise);
    await second.destroy();
    await third.destroy();
    await fourth.destroy();
  });

  it('短时间重复打开同一历史 PDF 复用文档，全部引用释放后延迟销毁', async () => {
    const task = {
      promise: Promise.resolve({ numPages: 1 }),
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    mocks.getDocument.mockReturnValue(task);

    const first = loadPdfPreview('/same.pdf');
    const second = loadPdfPreview('/same.pdf');
    expect(second.promise).toBe(first.promise);
    expect(mocks.getDocument).toHaveBeenCalledOnce();

    await first.destroy();
    await second.destroy();
    expect(task.destroy).not.toHaveBeenCalled();

    const third = loadPdfPreview('/same.pdf');
    expect(third.promise).toBe(first.promise);
    expect(mocks.getDocument).toHaveBeenCalledOnce();
    await third.destroy();
    await vi.advanceTimersByTimeAsync(30_001);
    expect(task.destroy).toHaveBeenCalledOnce();
  });

  it('should retain all fixed PDF examples when switching away for more than thirty seconds', async () => {
    const tasks = IMAGE_PARSE_SHARED_EXAMPLES.filter((example) => example.format === 'PDF').map(
      (example) => {
        const task = {
          promise: Promise.resolve({ numPages: example.pageCount }),
          destroy: vi.fn().mockResolvedValue(undefined),
        };
        mocks.getDocument.mockReturnValueOnce(task);
        return { example, task };
      },
    );
    mocks.getDocument.mockReturnValue(tasks[0].task);
    for (const { example } of tasks) await loadPdfPreview(example.url).destroy();
    await vi.advanceTimersByTimeAsync(60_000);

    const restored = loadPdfPreview(tasks[0].example.url);
    expect(restored.promise).toBe(tasks[0].task.promise);
    expect(mocks.getDocument).toHaveBeenCalledTimes(tasks.length);
    expect(tasks[0].task.destroy).not.toHaveBeenCalled();
    await restored.destroy();
  });
});
