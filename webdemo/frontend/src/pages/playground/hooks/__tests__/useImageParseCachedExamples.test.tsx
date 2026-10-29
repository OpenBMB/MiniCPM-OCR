import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useImageParseExamples } from '../useImageParseExamples';
import type { ImageParseSnapshot } from '../../utils/imageParseHistoryTypes';
import type { ImageParseExampleSnapshot } from '../../utils/imageParseExampleSnapshot';

const toast = vi.hoisted(() => vi.fn());
const loadSnapshot = vi.hoisted(() => vi.fn());
const mergeTables = vi.hoisted(() => vi.fn());
vi.mock('@map/ui', () => ({ useToast: () => ({ toast }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../utils/imageParseExampleSnapshot', () => ({
  loadImageParseExampleSnapshot: loadSnapshot,
}));
vi.mock('../../utils/imageParseTableMerge', () => ({ mergeImageParseTables: mergeTables }));

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

const snapshot: ImageParseSnapshot = {
  attachment: {
    id: 'example:physics',
    kind: 'image',
    name: '手写物理笔记.png',
    mime: 'image/png',
    size: 3,
    dataUrl: 'data:image/png;base64,AQID',
  },
  mode: 'scored',
  markdown: '数据库正文',
  layout: [],
};
const pages = [1, 2].map((page) => ({
  ...snapshot,
  attachment: { ...snapshot.attachment, id: 'example:invoices', name: `${page}.png` },
  markdown: `数据库第${page}页`,
  requestId: `request-${page}`,
}));

afterEach(() => {
  toast.mockReset();
  loadSnapshot.mockReset();
  mergeTables.mockReset();
});

describe('共享案例数据库快照加载', () => {
  it('点击案例读取数据库快照；再次点击复用已校验结果', async () => {
    loadSnapshot.mockResolvedValue(snapshot);
    const onReady = vi.fn(() => true);
    const { result } = renderHook(() => useImageParseExamples(onReady, 'scope'), { wrapper });
    expect(result.current.selectionRevision).toBe(0);
    act(() => result.current.load('physics'));
    await waitFor(() => expect(onReady).toHaveBeenCalledWith(snapshot));
    expect(result.current.selectionRevision).toBe(1);
    act(() => result.current.load('physics'));
    expect(onReady).toHaveBeenCalledTimes(2);
    expect(result.current.selectionRevision).toBe(2);
    expect(loadSnapshot).toHaveBeenCalledOnce();
    expect(loadSnapshot).toHaveBeenCalledWith('physics', expect.any(AbortSignal));
    expect(toast).not.toHaveBeenCalled();
  });

  it('票据翻页同步恢复附件和结果，拒绝越界页，缓存命中后重置第一页', async () => {
    loadSnapshot.mockResolvedValue({ ...pages[0], imagePages: pages });
    const onReady = vi.fn(() => true);
    const { result } = renderHook(
      () => useImageParseExamples(onReady, 'scope', 'example:invoices'),
      { wrapper },
    );
    act(() => result.current.load('invoices'));
    await waitFor(() => expect(result.current.images?.pages).toBe(2));
    const firstKey = result.current.pageKey;
    act(() => result.current.images?.setPage(2));
    expect(onReady).toHaveBeenLastCalledWith(pages[1]);
    expect(result.current.images?.name).toBe('2.png');
    expect(result.current.pageKey).not.toBe(firstKey);
    const calls = onReady.mock.calls.length;
    act(() => [0, 3, 1.5, 2].forEach((page) => result.current.images?.setPage(page)));
    expect(onReady).toHaveBeenCalledTimes(calls);
    act(() => result.current.images?.setPage(1));
    expect(result.current.pageKey).toBe(firstKey);
    act(() => result.current.load('invoices'));
    expect(result.current.images?.page).toBe(1);
    expect(loadSnapshot).toHaveBeenCalledOnce();
  });

  it('取消后旧分页回调不能覆盖当前文档', async () => {
    loadSnapshot.mockResolvedValue({ ...pages[0], imagePages: pages });
    const onReady = vi.fn(() => true);
    const { result } = renderHook(
      () => useImageParseExamples(onReady, 'scope', 'example:invoices'),
      { wrapper },
    );
    act(() => result.current.load('invoices'));
    await waitFor(() => expect(result.current.images?.pages).toBe(2));
    const oldPage = result.current.images!.setPage;
    act(() => result.current.cancel());
    act(() => oldPage(2));
    expect(result.current.images).toBeUndefined();
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('合并后当前页立即替换，翻页保留合并结果，取消后恢复原页', async () => {
    const merged = { markdown: '合并后第2页', blocks: [] };
    mergeTables.mockReturnValue(new Map([[1, merged]]));
    loadSnapshot.mockResolvedValue({ ...pages[0], imagePages: pages });
    const onReady = vi.fn(() => true);
    const { result } = renderHook(
      () => useImageParseExamples(onReady, 'scope', 'example:invoices'),
      { wrapper },
    );
    act(() => result.current.load('invoices'));
    await waitFor(() => expect(result.current.images?.pages).toBe(2));
    act(() => result.current.images?.setPage(2));
    expect(result.current.images?.tableMerge?.available).toBe(true);

    await act(async () => {
      await result.current.images!.tableMerge!.merge();
    });
    expect(onReady).toHaveBeenLastCalledWith(expect.objectContaining({ markdown: '合并后第2页' }));

    act(() => result.current.images?.setPage(1));
    expect(onReady).toHaveBeenLastCalledWith(pages[0]);
    act(() => result.current.images?.setPage(2));
    expect(onReady).toHaveBeenLastCalledWith(expect.objectContaining({ markdown: '合并后第2页' }));

    act(() => result.current.images?.tableMerge?.unmerge());
    expect(onReady).toHaveBeenLastCalledWith(pages[1]);
  });

  it('同一事件中加载后立即取消，不得在 mutation 开始后恢复旧案例', async () => {
    loadSnapshot.mockResolvedValue(snapshot);
    const onReady = vi.fn(() => true);
    const { result } = renderHook(() => useImageParseExamples(onReady, 'scope'), { wrapper });
    await act(async () => {
      result.current.load('physics');
      result.current.cancel();
    });
    expect(loadSnapshot).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'scope', 'replacement'] as const)(
    '%s 后忽略不遵守 abort 的迟到数据库响应',
    async (action) => {
      const finishes: ((value: ImageParseExampleSnapshot) => void)[] = [];
      loadSnapshot.mockImplementation(() => new Promise((resolve) => finishes.push(resolve)));
      const onReady = vi.fn(() => true);
      const { result, rerender } = renderHook(
        ({ scope }) => useImageParseExamples(onReady, scope),
        { wrapper, initialProps: { scope: 'old' } },
      );
      act(() => result.current.load('physics'));
      await waitFor(() => expect(loadSnapshot).toHaveBeenCalledOnce());
      if (action === 'scope') rerender({ scope: 'new' });
      else if (action === 'replacement') act(() => result.current.load('property'));
      else act(() => result.current.cancel());
      await act(async () => finishes[0](snapshot));
      expect(onReady).not.toHaveBeenCalled();
      expect(toast).not.toHaveBeenCalled();
      if (action === 'replacement') {
        await act(async () => finishes[1](snapshot));
        expect(onReady).toHaveBeenCalledOnce();
      }
    },
  );

  it('数据库结果缺失或损坏时提示错误，不恢复模拟结果，允许重试', async () => {
    loadSnapshot
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValue(snapshot);
    const onReady = vi.fn(() => true);
    const { result } = renderHook(() => useImageParseExamples(onReady, 'scope'), { wrapper });
    act(() => result.current.load('physics'));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: 'imageParseExampleLoadFailed',
        variant: 'error',
      }),
    );
    expect(onReady).not.toHaveBeenCalled();
    act(() => result.current.load('physics'));
    await waitFor(() => expect(onReady).toHaveBeenCalledWith(snapshot));
    expect(loadSnapshot).toHaveBeenCalledTimes(2);
  });

  it('恢复入口更新后使用最新回调，不恢复到旧工作台', async () => {
    let finish!: (value: ImageParseExampleSnapshot) => void;
    loadSnapshot.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const old = vi.fn(() => true);
    const next = vi.fn(() => true);
    const { result, rerender } = renderHook(({ ready }) => useImageParseExamples(ready, 'scope'), {
      wrapper,
      initialProps: { ready: old },
    });
    act(() => result.current.load('physics'));
    await waitFor(() => expect(loadSnapshot).toHaveBeenCalledOnce());
    rerender({ ready: next });
    await act(async () => finish(snapshot));
    expect(old).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(snapshot);
  });
});
