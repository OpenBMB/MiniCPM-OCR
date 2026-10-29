import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Attachment } from '../../types';
import { usePdfImageParse } from '../usePdfImageParse';
import type { PdfPageResult } from '../../utils/pdfImageParse';

const mocks = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock('../../utils/pdfImageParse', () => ({ parsePdfPages: mocks.parse }));
vi.mock('@/api/map/imageParseV2', () => ({
  crossPageMergeAvailable: vi.fn().mockResolvedValue(false),
  mergeImageParseCrossPage: vi.fn(),
}));
const attachment: Attachment = {
  id: 'pdf',
  kind: 'file',
  name: 'pages.pdf',
  mime: 'application/pdf',
  size: 12,
  dataUrl: 'data:application/pdf;base64,AAA',
};
const cached = {
  page: 2,
  pages: 2,
  results: {
    1: { result: { markdown: '# First', blocks: [] } },
    2: { result: { markdown: '# Second', blocks: [] } },
  },
};

describe('usePdfImageParse cached restore', () => {
  beforeEach(() => {
    mocks.parse.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should keep the PDF source out of serialized identity keys during restore and navigation', async () => {
    const stringify = vi.spyOn(JSON, 'stringify');
    const { result, rerender, unmount } = renderHook(
      ({ file }) => usePdfImageParse(file, 'standard', 'minicpm-ocr-aio', 'project-1'),
      {
        initialProps: { file: undefined as Attachment | undefined },
      },
    );
    act(() => result.current.restore(attachment, 'standard', cached));
    rerender({ file: attachment });
    act(() => result.current.setPage(1));

    expect(result.current.current?.result?.markdown).toBe('# First');
    expect(
      stringify.mock.calls.some(
        ([value]) => Array.isArray(value) && value.includes(attachment.dataUrl),
      ),
    ).toBe(false);
    expect(mocks.parse).not.toHaveBeenCalled();
    unmount();
  });

  it('should invalidate restored results when the source changes under the same attachment ID', async () => {
    const { result, rerender, unmount } = renderHook(
      ({ file }) => usePdfImageParse(file, 'standard', 'minicpm-ocr-aio', 'project-1'),
      {
        initialProps: { file: undefined as Attachment | undefined },
      },
    );
    act(() => result.current.restore(attachment, 'standard', cached));
    rerender({ file: attachment });
    rerender({ file: { ...attachment, dataUrl: '/replacement.pdf' } });

    expect(result.current.results).toEqual({});
    await act(async () => {});
    expect(mocks.parse).toHaveBeenCalledWith(
      '/replacement.pdf',
      'standard',
      'minicpm-ocr-aio',
      'project-1',
      expect.any(AbortSignal),
      expect.any(Function),
      expect.any(Function),
      undefined,
      expect.any(Function),
      undefined,
      true,
      true,
      { ...attachment, dataUrl: '/replacement.pdf' },
      undefined,
    );
    unmount();
  });

  it('文档识别逐页使用算法标准模式', async () => {
    const { unmount } = renderHook(() =>
      usePdfImageParse(attachment, 'standard', 'minicpm-ocr-aio', 'project-1'),
    );
    await waitFor(() => expect(mocks.parse).toHaveBeenCalledOnce());
    expect(mocks.parse).toHaveBeenCalledWith(
      attachment.dataUrl,
      'standard',
      'minicpm-ocr-aio',
      'project-1',
      expect.any(AbortSignal),
      expect.any(Function),
      expect.any(Function),
      undefined,
      expect.any(Function),
      undefined,
      true,
      true,
      attachment,
      undefined,
    );
    unmount();
  });

  it('相同原件的附件对象更新不会取消正在观察的任务，重试使用最新引用', async () => {
    mocks.parse.mockImplementation(() => new Promise<void>(() => {}));
    const { result, rerender, unmount } = renderHook(
      ({ file }) =>
        usePdfImageParse(
          file,
          'standard',
          'minicpm-ocr-aio',
          'project-1',
          true,
          undefined,
          false,
          true,
          false,
        ),
      { initialProps: { file: { ...attachment, fileId: 'file-original' } } },
    );
    act(() => result.current.parse());
    await waitFor(() => expect(mocks.parse).toHaveBeenCalledOnce());
    const signal = mocks.parse.mock.calls[0]![4] as AbortSignal;
    const updated = { ...attachment, fileId: 'file-original', name: 'renamed.pdf' };
    rerender({ file: updated });
    await act(async () => {});

    expect(signal.aborted).toBe(false);
    expect(result.current.loading).toBe(true);
    expect(mocks.parse).toHaveBeenCalledOnce();
    act(() => result.current.retryPage(1));
    expect(signal.aborted).toBe(true);
    expect(mocks.parse.mock.calls[1]![12]).toBe(updated);
    const retrySignal = mocks.parse.mock.calls[1]![4] as AbortSignal;
    unmount();
    expect(retrySignal.aborted).toBe(true);
  });

  it('切换印章展示不作废 PDF 结果，开始和单页重试始终开启印章识别', async () => {
    const { result, rerender, unmount } = renderHook(
      ({ file, recognizeSeal }) =>
        usePdfImageParse(
          file,
          'standard',
          'minicpm-ocr-aio',
          'project-1',
          true,
          undefined,
          false,
          true,
          false,
          recognizeSeal,
        ),
      { initialProps: { file: undefined as Attachment | undefined, recognizeSeal: true } },
    );
    act(() => result.current.restore(attachment, 'standard', cached));
    rerender({ file: attachment, recognizeSeal: true });
    expect(result.current.current?.result?.markdown).toBe('# Second');
    rerender({ file: attachment, recognizeSeal: false });
    expect(result.current.current?.result?.markdown).toBe('# Second');
    await act(async () => {});
    expect(mocks.parse).not.toHaveBeenCalled();
    act(() => result.current.parse());
    await waitFor(() => expect(mocks.parse).toHaveBeenCalledOnce());
    expect(mocks.parse.mock.calls[0]![11]).toBe(true);
    act(() => result.current.retryPage(1));
    await waitFor(() => expect(mocks.parse).toHaveBeenCalledTimes(2));
    expect(mocks.parse.mock.calls[1]![7]).toBe(1);
    expect(mocks.parse.mock.calls[1]![11]).toBe(true);
    unmount();
  });

  it('更换文档解析模型会作废旧结果并按新模型重新解析', async () => {
    mocks.parse.mockResolvedValue(undefined);
    const { result, rerender, unmount } = renderHook(
      ({ model }) => usePdfImageParse(attachment, 'standard', model, 'project-1'),
      { initialProps: { model: 'minicpm-ocr-aio' } },
    );
    await waitFor(() => expect(mocks.parse).toHaveBeenCalledOnce());
    rerender({ model: 'next-ocr-model' });
    expect(result.current.results).toEqual({});
    await waitFor(() => expect(mocks.parse).toHaveBeenCalledTimes(2));
    expect(mocks.parse.mock.calls[1]?.[2]).toBe('next-ocr-model');
    unmount();
  });

  it('恢复 PDF 页码和结果不执行自动 OCR，显式重试仍可解析', async () => {
    const { result, rerender } = renderHook(
      ({ file }) => usePdfImageParse(file, 'standard', 'minicpm-ocr-aio', 'project-1'),
      {
        initialProps: { file: undefined as Attachment | undefined },
      },
    );
    act(() => result.current.restore(attachment, 'standard', cached));
    rerender({ file: attachment });
    await act(async () => {});
    expect(result.current.page).toBe(2);
    expect(result.current.current?.result?.markdown).toBe('# Second');
    expect(result.current.snapshot).toMatchObject(cached);
    expect(mocks.parse).not.toHaveBeenCalled();
    act(() => result.current.parse());
    await waitFor(() => expect(mocks.parse).toHaveBeenCalledOnce());
  });

  it('追加页面后保留旧页并从第一张新页续跑', async () => {
    mocks.parse.mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ file }) => usePdfImageParse(file, 'standard', 'minicpm-ocr-aio', 'project-1'),
      {
        initialProps: { file: undefined as Attachment | undefined },
      },
    );
    act(() =>
      result.current.restore(
        { ...attachment, id: 'append', dataUrl: 'data:application/pdf;base64,APPEND' },
        'standard',
        {
          page: 2,
          pages: 3,
          results: { 1: { result: { markdown: '# Kept', blocks: [] } } },
        },
      ),
    );
    rerender({
      file: { ...attachment, id: 'append', dataUrl: 'data:application/pdf;base64,APPEND' },
    });
    await waitFor(() => expect(mocks.parse).toHaveBeenCalledOnce());
    expect(result.current.page).toBe(2);
    expect(result.current.results[1]?.result?.markdown).toBe('# Kept');
    expect(mocks.parse.mock.calls[0]?.[9]).toEqual(new Set([1]));
  });

  it('手动模式追加后自动续跑，保留已完成页再识别新页', async () => {
    mocks.parse.mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ file }) =>
        usePdfImageParse(
          file,
          'standard',
          'minicpm-ocr-aio',
          'project-1',
          true,
          undefined,
          false,
          true,
          false,
        ),
      { initialProps: { file: undefined as Attachment | undefined } },
    );
    await act(async () =>
      result.current.restore(attachment, 'standard', {
        page: 2,
        pages: 2,
        results: { 1: { result: { markdown: '# Kept', blocks: [] } } },
      }, { resumeIncomplete: true }),
    );
    rerender({ file: attachment });
    await waitFor(() => expect(mocks.parse).toHaveBeenCalledOnce());
    expect(result.current.results[1]?.result?.markdown).toBe('# Kept');
    expect(mocks.parse.mock.calls[0]?.[9]).toEqual(new Set([1]));
  });

  it('更换附件会取消已排队但尚未开始的自动解析', async () => {
    const { rerender, unmount } = renderHook(
      ({ file }) => usePdfImageParse(file, 'standard', 'minicpm-ocr-aio', 'project-1'),
      {
        initialProps: { file: attachment as Attachment | undefined },
      },
    );
    rerender({ file: undefined });
    await act(async () => {});
    expect(mocks.parse).not.toHaveBeenCalled();
    unmount();
  });

  it.each(['replacement', 'same-source-replacement', 'clear', 'unmount'] as const)(
    '恢复后重试在 %s 时中止，不接收延迟页面或结束回调',
    async (action) => {
      let finish!: () => void;
      mocks.parse.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      const { result, rerender, unmount } = renderHook(
        ({ file }) => usePdfImageParse(file, 'standard', 'minicpm-ocr-aio', 'project-1'),
        {
          initialProps: { file: undefined as Attachment | undefined },
        },
      );
      act(() => result.current.restore(attachment, 'standard', cached));
      rerender({ file: attachment });
      await act(async () => {});
      act(() => result.current.retryPage(2));
      const [, , , , signal, onOpen, onPage] = mocks.parse.mock.calls[0] as [
        string,
        string,
        string,
        string,
        AbortSignal,
        (pages: number) => void,
        (page: number, result: PdfPageResult) => void,
      ];
      const completeOld = finish;
      expect(signal.aborted).toBe(false);
      if (action === 'unmount') unmount();
      else
        rerender({
          file:
            action === 'clear'
              ? undefined
              : {
                  ...attachment,
                  id: 'next',
                  dataUrl:
                    action === 'replacement'
                      ? 'data:application/pdf;base64,NEXT'
                      : attachment.dataUrl,
                },
        });
      expect(signal.aborted).toBe(true);
      const beforeLate = result.current;
      await act(async () => {
        onOpen(100);
        onPage(2, { result: { markdown: '# Stale', blocks: [] } });
        completeOld();
      });
      if (action === 'unmount') expect(result.current).toBe(beforeLate);
      else {
        expect(result.current.results).toEqual({});
        expect(result.current.pages).toBe(0);
        expect(result.current.loading).toBe(action !== 'clear');
      }
    },
  );
});
