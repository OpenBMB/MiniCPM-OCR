import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useImageParseDownload } from '../useImageParseDownload';

const mocks = vi.hoisted(() => ({ create: vi.fn(), save: vi.fn(), toast: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@map/ui', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('../../utils/imageParseExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/imageParseExport')>()),
  createImageParseExport: mocks.create,
  saveImageParseExport: mocks.save,
}));

const input = { markdown: '# 当前正文', blocks: [], name: '识别.png', disabled: false };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockResolvedValue(new Blob(['result']));
});

describe('OCR 下载状态', () => {
  it('按格式生成并下载当前草稿', async () => {
    const { result } = renderHook(() => useImageParseDownload(input));
    await act(() => result.current.download('json'));
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith('json', input);
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(expect.any(Blob), '识别.json');
    expect(result.current.downloading).toBe(false);
  });

  it.each([
    { ...input, disabled: true },
    { ...input, markdown: '  ' },
  ])('禁用或空正文不生成文件', async (options) => {
    const { result } = renderHook(() => useImageParseDownload(options));
    await act(() => result.current.download('word'));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('文件生成期间禁用重复下载，完成后恢复入口', async () => {
    let finish!: (blob: Blob) => void;
    mocks.create.mockReturnValue(
      new Promise<Blob>((resolve) => {
        finish = resolve;
      }),
    );
    const { result } = renderHook(() => useImageParseDownload(input));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.download('word');
      void result.current.download('json');
    });
    expect(result.current.downloading).toBe(true);
    expect(mocks.create).toHaveBeenCalledOnce();
    await act(async () => {
      finish(new Blob(['docx']));
      await pending;
    });
    expect(result.current.downloading).toBe(false);
  });

  it('生成失败显示错误，仍可重新下载', async () => {
    mocks.create.mockRejectedValueOnce(new Error('generation-failed'));
    const { result } = renderHook(() => useImageParseDownload(input));
    await act(() => result.current.download('word'));
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith({
      title: 'imageParseDownloadFailed',
      variant: 'error',
    });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(result.current.downloading).toBe(false);
    await act(() => result.current.download('word'));
    expect(mocks.save).toHaveBeenCalledOnce();
  });

  it('异步生成使用点击时的内容和文件名，不串到新文档', async () => {
    let finish!: (blob: Blob) => void;
    mocks.create.mockReturnValue(
      new Promise<Blob>((resolve) => {
        finish = resolve;
      }),
    );
    const { result, rerender } = renderHook((options) => useImageParseDownload(options), {
      initialProps: input,
    });
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.download('word');
    });
    rerender({ ...input, markdown: '# 下一份文档', name: '下一份.png' });
    await act(async () => {
      finish(new Blob(['docx']));
      await pending;
    });
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith('word', input);
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(expect.any(Blob), '识别.docx');
  });
});
