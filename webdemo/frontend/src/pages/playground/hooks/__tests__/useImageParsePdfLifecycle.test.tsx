import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useImageParse } from '../useImageParse';
import type { ImageParseSnapshot } from '../../utils/imageParseHistory';
import type { PdfPageResult } from '../../utils/pdfImageParse';

const mocks = vi.hoisted(() => ({ pdf: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../utils/pdfImageParse', () => ({ parsePdfPages: mocks.pdf }));
const block = {
  id: 'same-block-id',
  kind: 'text' as const,
  x: 0.1,
  y: 0.1,
  w: 0.5,
  h: 0.1,
  text: 'Second',
  markdown: '# Second',
  confidence: 0.8,
};
const imageParseModel = { id: 'minicpm-ocr-aio' };
const cached: ImageParseSnapshot = {
  attachment: {
    id: 'pdf',
    kind: 'file',
    name: 'pages.pdf',
    mime: 'application/pdf',
    size: 12,
    dataUrl: 'data:application/pdf;base64,AAA',
  },
  mode: 'scored',
  markdown: '# Second',
  layout: [block],
  pdf: {
    page: 2,
    pages: 2,
    results: {
      1: { result: { markdown: '# First', blocks: [{ ...block, markdown: '# First' }] } },
      2: { result: { markdown: '# Second', blocks: [block] } },
    },
  },
};

describe('useImageParse PDF recognition identity and cancellation', () => {
  beforeEach(() => {
    mocks.pdf.mockReset().mockImplementation(() => new Promise(() => {}));
  });

  it('229 页任务中快速切页只启动一轮解析，已完成页面不会丢失或重识别', async () => {
    let finish!: () => void;
    mocks.pdf.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    const { result } = renderHook(() =>
      useImageParse({
        userId: 'u',
        defaultProjectId: 'p',
        imageParseModel,
        getSecret: () => 'plain-secret',
      } as never),
    );
    act(() => result.current.setAttachment(cached.attachment));
    await waitFor(() => expect(mocks.pdf).toHaveBeenCalledOnce());
    const [, , , , signal, onOpen, onPage] = mocks.pdf.mock.calls[0] as [
      string,
      string,
      string,
      string,
      AbortSignal,
      (pages: number) => void,
      (page: number, result: PdfPageResult) => void,
    ];
    act(() => {
      onOpen(229);
      onPage(1, cached.pdf!.results[1]);
    });
    for (const page of [225, 229, 2, 1, 224, 10, 225]) {
      act(() => result.current.pdf?.setPage(page));
      await act(async () => {});
      expect(result.current.pdf?.page).toBe(page);
      expect(result.current.loading).toBe(true);
      expect(result.current.snapshot?.pdf?.pages).toBe(229);
      expect(signal.aborted).toBe(false);
      expect(mocks.pdf).toHaveBeenCalledOnce();
      expect(result.current.pdf?.results[1]).toBe(cached.pdf!.results[1]);
    }
    await act(async () => {
      onPage(225, { result: { markdown: '# Page 225', blocks: [] } });
      finish();
    });
    expect(result.current.markdown).toBe('# Page 225');
    expect(result.current.loading).toBe(false);
    expect(result.current.pdf?.completed).toBe(2);
    act(() => result.current.pdf?.setPage(1));
    expect(result.current.markdown).toBe('# First');
    expect(mocks.pdf).toHaveBeenCalledOnce();
  });

  it('可在切页前取得目标页结果身份，单页重试后仍与实际切页身份一致', () => {
    const { result } = renderHook(() =>
      useImageParse({
        userId: 'u',
        defaultProjectId: 'p',
        imageParseModel,
        getSecret: () => 'plain-secret',
      } as never),
    );
    act(() => result.current.restore(cached));
    const firstKey = result.current.resultKeyForPage(1);
    const secondKey = result.current.resultKey;
    act(() => result.current.pdf?.setPage(1));
    expect(result.current.resultKey).toBe(firstKey);
    expect(result.current.resultKeyForPage(2)).toBe(secondKey);
    act(() => result.current.pdf?.retryPage(2));
    const retriedKey = result.current.resultKeyForPage(2);
    expect(retriedKey).not.toBe(secondKey);
    act(() => result.current.pdf?.setPage(2));
    expect(result.current.resultKey).toBe(retriedKey);
  });

  it('整篇重解析及时更新所有页的 key，完成后和往返切页均保持该任务身份', async () => {
    let finish!: () => void;
    mocks.pdf.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useImageParse({
        userId: 'u',
        defaultProjectId: 'p',
        imageParseModel,
        getSecret: () => 'plain-secret',
      } as never),
    );
    act(() => result.current.restore(cached));
    const oldSecond = result.current.resultKey;
    act(() => result.current.pdf?.setPage(1));
    const oldFirst = result.current.resultKey;
    act(() => result.current.pdf?.setPage(2));
    expect(result.current.resultKey).toBe(oldSecond);
    act(() => {
      void result.current.parse();
    });
    expect(result.current.resultKey).not.toBe(oldSecond);
    expect(mocks.pdf).not.toHaveBeenCalled();
    await act(async () => {});
    expect(result.current.resultKey).not.toBe(oldFirst);
    act(() => result.current.pdf?.setPage(2));
    const newSecond = result.current.resultKey;
    expect(newSecond).not.toBe(oldSecond);
    act(() => result.current.pdf?.setPage(1));
    expect(result.current.resultKey).not.toBe(oldFirst);
    act(() => result.current.pdf?.setPage(2));
    expect(result.current.resultKey).toBe(newSecond);
    const [, , , , , onOpen, onPage] = mocks.pdf.mock.calls[0] as [
      string,
      string,
      string,
      string,
      AbortSignal,
      (pages: number) => void,
      (page: number, result: PdfPageResult) => void,
    ];
    await act(async () => {
      onOpen(2);
      onPage(1, cached.pdf!.results[1]);
      onPage(2, cached.pdf!.results[2]);
      finish();
    });
    expect(result.current.resultKey).toBe(newSecond);
    expect(result.current.layout[0].id).toBe('same-block-id');
  });

  it('单页重试在完成前更新该页 key，不改变其他页 key', async () => {
    let finish!: () => void;
    mocks.pdf.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useImageParse({
        userId: 'u',
        defaultProjectId: 'p',
        imageParseModel,
        getSecret: () => 'plain-secret',
      } as never),
    );
    act(() => result.current.restore(cached));
    const oldSecond = result.current.resultKey;
    act(() => result.current.pdf?.setPage(1));
    const oldFirst = result.current.resultKey;
    act(() => result.current.pdf?.retryPage(2));
    expect(result.current.resultKey).toBe(oldFirst);
    act(() => result.current.pdf?.setPage(2));
    const newSecond = result.current.resultKey;
    expect(newSecond).not.toBe(oldSecond);
    const [, , , , , , onPage] = mocks.pdf.mock.calls[0] as [
      string,
      string,
      string,
      string,
      AbortSignal,
      (pages: number) => void,
      (page: number, result: PdfPageResult) => void,
    ];
    await act(async () => {
      onPage(2, {
        result: { markdown: '# Retried', blocks: [{ ...block, markdown: '# Retried' }] },
      });
      finish();
    });
    expect(result.current.resultKey).toBe(newSecond);
    expect(result.current.markdown).toBe('# Retried');
    act(() => result.current.pdf?.setPage(1));
    expect(result.current.resultKey).toBe(oldFirst);
    act(() => result.current.pdf?.setPage(2));
    expect(result.current.resultKey).toBe(newSecond);
  });

  it('恢复后重试在项目切换时中止，不让延迟页结果进入新范围', async () => {
    let finish!: () => void;
    mocks.pdf.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { result, rerender } = renderHook(
      ({ project }) =>
        useImageParse({
          userId: 'u',
          defaultProjectId: project,
          imageParseModel,
          getSecret: () => 'plain-secret',
        } as never),
      { initialProps: { project: 'p' } },
    );
    act(() => result.current.restore(cached));
    act(() => result.current.pdf?.retryPage(2));
    const [, , , , signal, , onPage] = mocks.pdf.mock.calls[0] as [
      string,
      string,
      string,
      string,
      AbortSignal,
      (pages: number) => void,
      (page: number, result: PdfPageResult) => void,
    ];
    rerender({ project: 'other' });
    await waitFor(() => expect(result.current.attachment).toBeUndefined());
    expect(signal.aborted).toBe(true);
    await act(async () => {
      onPage(2, { result: { markdown: '# Stale', blocks: [] } });
      finish();
    });
    expect(result.current.markdown).toBe('');
    expect(result.current.snapshot).toBeNull();
  });
});
