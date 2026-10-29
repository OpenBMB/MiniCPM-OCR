import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rebuildPdfPageCrops } from '../pdfImageParseCrops';

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  render: vi.fn(),
  crops: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock('../pdfPreview', () => ({ loadPdfPreview: mocks.load }));
vi.mock('../pdfPageImage', () => ({ renderPdfPageImage: mocks.render }));
vi.mock('../imageParseCrops', () => ({ imageParseCrops: mocks.crops }));
const document = { numPages: 3 };
const result = { markdown: '![image]()', blocks: [] };

describe('PDF 云端历史裁图重建', () => {
  beforeEach(() => {
    mocks.destroy.mockReset().mockResolvedValue(undefined);
    mocks.load
      .mockReset()
      .mockReturnValue({ promise: Promise.resolve(document), destroy: mocks.destroy });
    mocks.render.mockReset().mockResolvedValue('data:image/png;base64,YQ==');
    mocks.crops.mockReset().mockResolvedValue(['crop']);
  });

  it('从保存的原件渲染指定页，再调用已有裁图逻辑并释放 PDF', async () => {
    const signal = new AbortController().signal;
    expect(await rebuildPdfPageCrops('saved-pdf', 2, result, signal)).toEqual(['crop']);
    expect(mocks.load).toHaveBeenCalledWith('saved-pdf');
    expect(mocks.render).toHaveBeenCalledWith(document, 2, signal);
    expect(mocks.crops).toHaveBeenCalledWith(
      result.markdown,
      result.blocks,
      'data:image/png;base64,YQ==',
      signal,
      undefined,
      { allPictures: true },
    );
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it('取消时终止本地任务，不返回旧裁图且只销毁一次', async () => {
    const controller = new AbortController();
    mocks.render.mockImplementation(async (_pdf, _page, signal: AbortSignal) => {
      controller.abort();
      signal.throwIfAborted();
    });
    await expect(rebuildPdfPageCrops('saved-pdf', 2, result, controller.signal)).rejects.toThrow();
    expect(mocks.crops).not.toHaveBeenCalled();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it('已取消的恢复不打开文件或渲染页面', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(rebuildPdfPageCrops('saved-pdf', 2, result, controller.signal)).rejects.toThrow();
    expect(mocks.load).not.toHaveBeenCalled();
  });
});
