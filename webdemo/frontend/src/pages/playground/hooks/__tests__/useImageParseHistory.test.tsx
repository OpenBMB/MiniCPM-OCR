import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useImageParseHistory } from '../useImageParseHistory';
import type { ImageParseSnapshot } from '../../utils/imageParseHistoryTypes';

const mocks = vi.hoisted(() => ({ list: vi.fn(), load: vi.fn(), save: vi.fn(), remove: vi.fn() }));
vi.mock('../../utils/imageParseHistoryMigration', () => ({
  loadImageParseHistoryPage: mocks.list,
}));
vi.mock('@/api/map/imageParseHistory', () => ({
  getImageParseHistory: mocks.load,
  saveImageParseHistory: mocks.save,
  deleteImageParseHistory: mocks.remove,
}));
const snapshot = {
  attachment: {
    id: 'doc',
    kind: 'image' as const,
    name: 'scan.png',
    mime: 'image/png',
    size: 1,
    dataUrl: 'data:image/png;base64,YQ==',
  },
  mode: 'scored' as const,
  markdown: '# Saved',
  layout: [],
};
const entry = { id: 'history', createdAt: 1, snapshot };
const summary = { id: entry.id, createdAt: 1, attachmentId: 'doc', name: 'scan.png' };

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Provider({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useImageParseHistory 云端个人记录', () => {
  beforeEach(() => {
    mocks.list.mockReset().mockResolvedValue({ list: [summary], hasMore: false });
    mocks.load.mockReset().mockResolvedValue(entry);
    mocks.save.mockReset().mockResolvedValue(summary);
    mocks.remove.mockReset().mockResolvedValue(undefined);
  });

  it('首屏只读取本人摘要，点击打开时才加载完整文档', async () => {
    const { result } = renderHook(() => useImageParseHistory({ userId: 'u', projectId: 'p' }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.items).toEqual([summary]));
    expect(mocks.list).toHaveBeenCalledWith(
      { userId: 'u', projectId: 'p' },
      0,
      expect.any(AbortSignal),
      'standard',
    );
    expect(mocks.load).not.toHaveBeenCalled();
    await act(async () => expect(await result.current.load(entry.id)).toEqual(entry));
    expect(mocks.load).toHaveBeenCalledWith(
      { userId: 'u', projectId: 'p' },
      entry.id,
      expect.any(AbortSignal),
      false,
      'standard',
    );
  });

  it('KIE 入口只请求关键信息抽取历史，也不把全文快照写入 KIE 队列', async () => {
    const { result } = renderHook(
      () => useImageParseHistory({ userId: 'u', projectId: 'p', task: 'kie' }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.items).toEqual([summary]));
    expect(mocks.list).toHaveBeenLastCalledWith(
      { userId: 'u', projectId: 'p' },
      0,
      expect.any(AbortSignal),
      'kie',
    );
    await act(async () => expect(await result.current.save(snapshot)).toBe(false));
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('短时间内重复打开同一云端记录复用缓存，不重复拉取大快照', async () => {
    const { result } = renderHook(() => useImageParseHistory({ userId: 'u', projectId: 'p' }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.items).toEqual([summary]));
    await act(async () => expect(await result.current.load(entry.id)).toEqual(entry));
    await act(async () => expect(await result.current.load(entry.id)).toEqual(entry));
    expect(mocks.load).toHaveBeenCalledOnce();
  });

  it('保存失败保留已读取历史，不把临时记录伪装成云端保存成功', async () => {
    const { result } = renderHook(() => useImageParseHistory({ userId: 'u', projectId: 'p' }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.items).toEqual([summary]));
    mocks.save.mockRejectedValue(new Error('offline'));
    await act(async () => expect(await result.current.save(snapshot)).toBe(false));
    expect(result.current.items).toEqual([summary]);
    expect(result.current.storageError).toBe('imageParseHistoryStorageError');
    expect(result.current.storageNotice).toBeUndefined();
  });

  it('保存其他文档后仍复用已打开的详情，不再次下载原件', async () => {
    const { result } = renderHook(() => useImageParseHistory({ userId: 'u', projectId: 'p' }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.items).toEqual([summary]));
    await act(async () => expect(await result.current.load(entry.id)).toEqual(entry));
    const other = { ...snapshot, attachment: { ...snapshot.attachment, id: 'other' } };
    mocks.save.mockResolvedValueOnce({ ...summary, id: 'other-history', attachmentId: 'other' });
    await act(async () => expect(await result.current.save(other)).toBe(true));
    await act(async () => expect(await result.current.load(entry.id)).toEqual(entry));
    expect(mocks.load).toHaveBeenCalledOnce();
  });

  it('同一历史更新后再次打开读取新结果，附件定位缓存也同步失效', async () => {
    const { result } = renderHook(() => useImageParseHistory({ userId: 'u', projectId: 'p' }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.items).toEqual([summary]));
    await act(async () => {
      await result.current.load(entry.id);
      await result.current.load(snapshot.attachment.id, true);
    });
    act(() => result.current.setActiveEntry(entry));
    const edited = { ...snapshot, markdown: '# Edited' };
    await act(async () => expect(await result.current.save(edited)).toBe(true));
    mocks.load.mockResolvedValue({ ...entry, snapshot: edited });
    await act(async () => {
      expect((await result.current.load(entry.id))?.snapshot.markdown).toBe('# Edited');
      expect((await result.current.load(snapshot.attachment.id, true))?.snapshot.markdown).toBe(
        '# Edited',
      );
    });
    expect(mocks.load).toHaveBeenCalledTimes(4);
  });

  it('恢复云端记录后的首个快照不重复保存，后续编辑仍更新原记录', async () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: ImageParseSnapshot | null }) =>
        useImageParseHistory({ userId: 'u', projectId: 'p', snapshot: value }),
      { initialProps: { value: null as ImageParseSnapshot | null }, wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.items).toEqual([summary]));
    act(() => result.current.setActiveEntry(entry));
    rerender({ value: null });
    rerender({ value: entry.snapshot as ImageParseSnapshot });
    await act(async () => {});
    expect(mocks.save).not.toHaveBeenCalled();
    rerender({ value: { ...entry.snapshot, markdown: '# Edited' } as ImageParseSnapshot });
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save).toHaveBeenCalledWith(
      { userId: 'u', projectId: 'p' },
      expect.objectContaining({ markdown: '# Edited' }),
      entry.id,
    );
  });

  it('从另一条记录恢复时忽略中间空快照，不把恢复结果再次保存', async () => {
    const secondSnapshot = {
      ...snapshot,
      attachment: { ...snapshot.attachment, id: 'doc-2' },
      markdown: '# Second',
    } as ImageParseSnapshot;
    const secondEntry = { id: 'second', createdAt: 2, snapshot: secondSnapshot };
    const { result, rerender } = renderHook(
      ({ value }: { value: ImageParseSnapshot | null }) =>
        useImageParseHistory({ userId: 'u', projectId: 'p', snapshot: value }),
      { initialProps: { value: snapshot as ImageParseSnapshot | null }, wrapper: wrapper() },
    );
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    mocks.save.mockClear();
    act(() => result.current.setActiveEntry(secondEntry));
    rerender({ value: null });
    rerender({ value: secondSnapshot });
    await act(async () => {});
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('保存后新页面仍从服务端读取同一记录，不依赖浏览器 IndexedDB', async () => {
    const first = renderHook(() => useImageParseHistory({ userId: 'u', projectId: 'p' }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    await act(async () => expect(await first.result.current.save(snapshot)).toBe(true));
    first.unmount();
    const next = renderHook(() => useImageParseHistory({ userId: 'u', projectId: 'p' }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(next.result.current.items).toEqual([summary]));
    expect(mocks.list.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('切换账号或项目立即隐藏旧记录，也丢弃旧范围的打开结果', async () => {
    let finish!: (value: typeof entry) => void;
    mocks.load.mockImplementation(
      () =>
        new Promise<typeof entry>((resolve) => {
          finish = resolve;
        }),
    );
    const { result, rerender } = renderHook(
      ({ userId, projectId }) => useImageParseHistory({ userId, projectId }),
      { initialProps: { userId: 'u', projectId: 'p' }, wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.items).toEqual([summary]));
    const pending = result.current.load(entry.id);
    mocks.list.mockResolvedValue({ list: [], hasMore: false });
    rerender({ userId: 'other', projectId: 'p' });
    expect(result.current.items).toEqual([]);
    await act(async () => {
      finish(entry);
      expect(await pending).toBeNull();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ userId: 'other', projectId: 'other-project' });
    expect(result.current.items).toEqual([]);
  });

  it('完成快照只保存一次，恢复记录沿用原身份，即使默认识别模式变更', async () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: ImageParseSnapshot | null }) =>
        useImageParseHistory({ userId: 'u', projectId: 'p', snapshot: value }),
      { initialProps: { value: snapshot as ImageParseSnapshot | null }, wrapper: wrapper() },
    );
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    rerender({ value: snapshot });
    expect(mocks.save).toHaveBeenCalledOnce();
    act(() => result.current.setActiveEntry(entry));
    rerender({ value: { ...snapshot, mode: 'high-precision' } });
    await waitFor(() =>
      expect(mocks.save).toHaveBeenLastCalledWith(
        { userId: 'u', projectId: 'p' },
        expect.objectContaining({ mode: 'high-precision' }),
        entry.id,
      ),
    );
  });

  it('229 页 PDF 快速翻页和本地补图不重复上传整篇历史，真正更新结果仍保存', async () => {
    const pdfSnapshot: ImageParseSnapshot = {
      ...snapshot,
      attachment: {
        ...snapshot.attachment,
        kind: 'file',
        name: 'long.pdf',
        mime: 'application/pdf',
      },
      pdf: {
        page: 1,
        pages: 229,
        results: Object.fromEntries(
          Array.from({ length: 229 }, (_, index) => [
            index + 1,
            { result: { markdown: `Page ${index + 1}`, blocks: [] } },
          ]),
        ),
      },
    };
    const { rerender } = renderHook(
      ({ value }) => useImageParseHistory({ userId: 'u', projectId: 'p', snapshot: value }),
      { initialProps: { value: pdfSnapshot }, wrapper: wrapper() },
    );
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    const reads = mocks.list.mock.calls.length;
    for (const page of [225, 2, 229, 10, 224, 1, 225]) {
      rerender({
        value: {
          ...pdfSnapshot,
          markdown: `Page ${page}`,
          pdf: { ...pdfSnapshot.pdf!, page },
        },
      });
      await act(async () => {});
    }
    const withCrops = {
      ...pdfSnapshot,
      pdf: {
        ...pdfSnapshot.pdf!,
        results: {
          ...pdfSnapshot.pdf!.results,
          225: { ...pdfSnapshot.pdf!.results[225], crops: ['data:image/png;base64,YQ=='] },
        },
      },
    };
    rerender({ value: withCrops });
    await act(async () => {});
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.list).toHaveBeenCalledTimes(reads);

    const updated = {
      ...withCrops,
      pdf: {
        ...withCrops.pdf,
        results: {
          ...withCrops.pdf.results,
          225: { result: { markdown: 'Retried page', blocks: [] } },
        },
      },
    };
    rerender({ value: updated });
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.lastCall?.[1]).toBe(updated);
  });

  it('自动保存失败后允许受限重试，失败期间快速切页不会连续发送整篇快照', async () => {
    let now = 10_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    mocks.save.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(summary);
    const value: ImageParseSnapshot = {
      ...snapshot,
      pdf: {
        page: 1,
        pages: 229,
        results: { 1: { result: { markdown: '# Page 1', blocks: [] } } },
      },
    };
    const { result, rerender } = renderHook(
      ({ value }) => useImageParseHistory({ userId: 'u', projectId: 'p', snapshot: value }),
      { initialProps: { value }, wrapper: wrapper() },
    );
    try {
      await waitFor(() =>
        expect(result.current.storageError).toBe('imageParseHistoryStorageError'),
      );
      for (const page of [225, 2, 229, 10, 224, 1]) {
        rerender({ value: { ...value, pdf: { ...value.pdf!, page } } });
        await act(async () => {});
      }
      expect(mocks.save).toHaveBeenCalledOnce();
      now += 5_000;
      rerender({ value: { ...value, pdf: { ...value.pdf!, page: 225 } } });
      await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(result.current.storageError).toBeUndefined());
      rerender({ value: { ...value, pdf: { ...value.pdf!, page: 1 } } });
      await act(async () => {});
      expect(mocks.save).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });

  it('整篇自动保存尚未返回时快速切页不重复排队上传', async () => {
    let finish!: (value: typeof summary) => void;
    mocks.save.mockImplementationOnce(
      () => new Promise<typeof summary>((resolve) => (finish = resolve)),
    );
    const value: ImageParseSnapshot = {
      ...snapshot,
      pdf: {
        page: 1,
        pages: 229,
        results: { 1: { result: { markdown: '# Page 1', blocks: [] } } },
      },
    };
    const { rerender } = renderHook(
      ({ value }) => useImageParseHistory({ userId: 'u', projectId: 'p', snapshot: value }),
      { initialProps: { value }, wrapper: wrapper() },
    );
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    for (const page of [225, 2, 229, 10, 224, 1]) {
      rerender({ value: { ...value, pdf: { ...value.pdf!, page } } });
    }
    await act(async () => finish(summary));
    expect(mocks.save).toHaveBeenCalledOnce();
  });

  it('自动保存按提交顺序执行，避免旧快照晚返回覆盖较新结果', async () => {
    let finish!: (value: typeof summary) => void;
    mocks.save.mockImplementationOnce(
      () =>
        new Promise<typeof summary>((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useImageParseHistory({ userId: 'u', projectId: 'p' }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const first = result.current.save(snapshot);
    const second = result.current.save({ ...snapshot, markdown: '# Newer' });
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    await act(async () => {
      finish(summary);
      await first;
      await second;
    });
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.lastCall?.[1].markdown).toBe('# Newer');
  });

  it('切换账号后排队中的旧保存不再发送', async () => {
    let finish!: (value: typeof summary) => void;
    mocks.save.mockImplementationOnce(
      () =>
        new Promise<typeof summary>((resolve) => {
          finish = resolve;
        }),
    );
    const { result, rerender } = renderHook(
      ({ userId }) => useImageParseHistory({ userId, projectId: 'p' }),
      { initialProps: { userId: 'u' }, wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    const first = result.current.save(snapshot);
    const queued = result.current.save({ ...snapshot, markdown: '# Queued' });
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    rerender({ userId: 'other' });
    await act(async () => {
      finish(summary);
      await first;
      expect(await queued).toBe(false);
    });
    expect(mocks.save).toHaveBeenCalledOnce();
  });

  it('切换账号或项目后不把尚未清除的旧完成快照提交到新范围', async () => {
    const { rerender } = renderHook(
      ({ userId, projectId }) => useImageParseHistory({ userId, projectId, snapshot }),
      { initialProps: { userId: 'u', projectId: 'p' }, wrapper: wrapper() },
    );
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    rerender({ userId: 'other', projectId: 'p' });
    await act(async () => {});
    rerender({ userId: 'other', projectId: 'other-project' });
    await act(async () => {});
    expect(mocks.save).toHaveBeenCalledOnce();
  });

  it('成功删除后不再提交同一附件的排队保存', async () => {
    const { result } = renderHook(() => useImageParseHistory({ userId: 'u', projectId: 'p' }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.items).toEqual([summary]));
    mocks.list.mockResolvedValue({ list: [], hasMore: false });
    await act(async () => expect(await result.current.remove(entry.id)).toBe(true));
    await act(async () => expect(await result.current.save(snapshot)).toBe(false));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([]);
  });

  it('加载更多使用摘要条数作为偏移，不加载完整原始文件', async () => {
    mocks.list.mockResolvedValueOnce({ list: [summary], hasMore: true }).mockResolvedValue({
      list: [{ ...summary, id: 'second', attachmentId: 'second' }],
      hasMore: false,
    });
    const { result } = renderHook(() => useImageParseHistory({ userId: 'u', projectId: 'p' }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    act(() => result.current.loadMore?.());
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(mocks.list).toHaveBeenLastCalledWith(
      { userId: 'u', projectId: 'p' },
      1,
      expect.any(AbortSignal),
      'standard',
    );
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('身份未就绪时不读写，空列表引用稳定', async () => {
    const { result, rerender } = renderHook(
      () => useImageParseHistory({ projectId: 'p', snapshot }),
      { wrapper: wrapper() },
    );
    const empty = result.current.items;
    rerender();
    expect(result.current.items).toBe(empty);
    await act(async () => expect(await result.current.save(snapshot)).toBe(false));
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
