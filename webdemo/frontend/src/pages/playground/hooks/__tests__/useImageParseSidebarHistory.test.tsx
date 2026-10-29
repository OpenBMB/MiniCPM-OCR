import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaygroundSidebarHistory } from '../../components/PlaygroundHistoryList';
import { useImageParseSidebarHistory } from '../useImageParseSidebarHistory';
import { IMAGE_PARSE_SHARED_EXAMPLES } from '../../utils/imageParseExamples';

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), t: (key: string) => key }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock('@map/ui', () => ({ confirm: mocks.confirm }));
const entry = {
  id: 'record',
  createdAt: 1,
  attachmentId: 'doc',
  name: 'scan.png',
  snapshot: {
    attachment: {
      id: 'doc',
      kind: 'image' as const,
      name: 'scan.png',
      mime: 'image/png',
      size: 12,
      dataUrl: 'data:image/png;base64,AAA',
    },
    mode: 'high-precision' as const,
    markdown: '# Cached',
    layout: [],
  },
};

function options(
  overrides: Partial<
    Pick<Parameters<typeof useImageParseSidebarHistory>[0], 'scope' | 'attachmentId'>
  > = {},
) {
  return {
    scope: 'user:project',
    attachmentId: 'doc' as string | undefined,
    history: {
      items: [entry],
      load: vi.fn().mockResolvedValue(entry),
      loading: false,
      save: vi.fn(),
      setActiveEntry: vi.fn(),
      refresh: vi.fn(),
      remove: vi.fn().mockResolvedValue(true),
    },
    onRestore: vi.fn().mockReturnValue(true),
    onNew: vi.fn(),
    onExample: vi.fn(),
    onSelectIntent: vi.fn(),
    onChange: vi.fn<(value: PlaygroundSidebarHistory | undefined) => void>(),
    ...overrides,
  };
}

function view(props: ReturnType<typeof options>): PlaygroundSidebarHistory {
  const calls = props.onChange.mock.calls;
  return calls[calls.length - 1][0]!;
}

describe('useImageParseSidebarHistory', () => {
  beforeEach(() => {
    mocks.confirm.mockReset().mockResolvedValue(true);
  });

  it('仅向页面壳提供共享案例和个人摘要，打开时再读取当前完整记录', async () => {
    const props = options();
    renderHook(() => useImageParseSidebarHistory(props));
    expect(view(props).sessions).toEqual([
      ...IMAGE_PARSE_SHARED_EXAMPLES.map((example) => ({
        id: example.id,
        title: example.label,
        category: 'example',
      })),
      { id: 'record', title: 'scan.png' },
    ]);
    expect(view(props).activeSessionId).toBe('record');
    expect(props.history.load).not.toHaveBeenCalled();
    await act(async () => view(props).onSelectSession('record'));
    expect(props.onSelectIntent).toHaveBeenCalledOnce();
    expect(props.onSelectIntent.mock.invocationCallOrder[0]).toBeLessThan(
      props.history.load.mock.invocationCallOrder[0],
    );
    expect(props.onRestore).toHaveBeenCalledWith(entry);
    expect(props.history.setActiveEntry).toHaveBeenCalledWith(entry);
    expect(props.history.save).not.toHaveBeenCalled();
    expect(props.history.refresh).not.toHaveBeenCalled();
  });

  it('云端记录恢复期间侧栏只标记当前待读取行，完成后清除状态', async () => {
    const props = options();
    let finish!: (value: typeof entry) => void;
    props.history.load.mockImplementationOnce(
      () =>
        new Promise<typeof entry>((resolve) => {
          finish = resolve;
        }),
    );
    renderHook(() => useImageParseSidebarHistory(props));
    let pending: void | Promise<void>;
    act(() => {
      pending = view(props).onSelectSession('record');
    });
    expect(
      (view(props) as PlaygroundSidebarHistory & { pendingSessionId?: string }).pendingSessionId,
    ).toBe('record');
    await act(async () => {
      finish(entry);
      await pending;
    });
    expect(
      (view(props) as PlaygroundSidebarHistory & { pendingSessionId?: string }).pendingSessionId,
    ).toBeUndefined();
  });

  it('案例与个人历史完全独立，即使个人文件与案例同名也不公开', async () => {
    const props = options();
    props.history.items = [
      entry,
      ...['demo-invoice.png', 'demo-document.pdf', 'demo-personal.pdf'].map((name, index) => ({
        ...entry,
        id: `document-${index}`,
        name,
        attachmentId: `attachment-${index}`,
        snapshot: {
          ...entry.snapshot,
          attachment: { ...entry.snapshot.attachment, id: `attachment-${index}`, name },
        },
      })),
    ];
    renderHook(() => useImageParseSidebarHistory(props));
    expect(view(props).sessions.filter((session) => session.category !== 'example')).toEqual([
      { id: entry.id, title: 'scan.png' },
      { id: 'document-0', title: 'demo-invoice.png' },
      { id: 'document-1', title: 'demo-document.pdf' },
      { id: 'document-2', title: 'demo-personal.pdf' },
    ]);
    await act(async () => view(props).onSelectSession('example:newspaper'));
    expect(props.onExample).toHaveBeenCalledWith('newspaper');
    expect(props.history.load).not.toHaveBeenCalled();
    expect(props.onRestore).not.toHaveBeenCalled();
  });

  it('新账号没有历史时仍展示相同的共享案例，案例不能走个人删除接口', async () => {
    const props = options();
    props.history.items = [];
    renderHook(() => useImageParseSidebarHistory(props));
    expect(view(props).sessions).toHaveLength(IMAGE_PARSE_SHARED_EXAMPLES.length);
    await act(async () => view(props).onSelectSession('example:physics'));
    expect(props.onExample).toHaveBeenCalledWith('physics');
    await act(async () => view(props).onDeleteSession('example:physics'));
    expect(props.history.remove).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('查看共享案例时高亮对应案例，不混入个人历史', () => {
    const props = options({ attachmentId: 'example:physics' });
    renderHook(() => useImageParseSidebarHistory(props));
    expect(view(props).activeSessionId).toBe('example:physics');
  });

  it('连续点击以最后一次选择为准，较早返回的云端结果不覆盖当前记录', async () => {
    const props = options();
    const second = { ...entry, id: 'second', attachmentId: 'second' };
    props.history.items = [entry, second];
    let finish!: (value: typeof entry) => void;
    props.history.load
      .mockImplementationOnce(
        () =>
          new Promise<typeof entry>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(second);
    renderHook(() => useImageParseSidebarHistory(props));
    const pending = view(props).onSelectSession(entry.id);
    await act(async () => view(props).onSelectSession(second.id));
    await act(async () => {
      finish(entry);
      await pending;
    });
    expect(props.onRestore).toHaveBeenCalledExactlyOnceWith(second);
  });

  it('云端读取期间切换账号后不恢复旧用户的文档', async () => {
    const props = options();
    let finish!: (value: typeof entry) => void;
    props.history.load.mockImplementationOnce(
      () =>
        new Promise<typeof entry>((resolve) => {
          finish = resolve;
        }),
    );
    const { rerender } = renderHook((value) => useImageParseSidebarHistory(value), {
      initialProps: props,
    });
    const pending = view(props).onSelectSession(entry.id);
    rerender({ ...props, scope: 'another-user:project' });
    await act(async () => {
      finish(entry);
      await pending;
    });
    expect(props.onRestore).not.toHaveBeenCalled();
  });

  it('新建调用清空工作台；无效或已删除记录不能恢复', async () => {
    const props = options();
    renderHook(() => useImageParseSidebarHistory(props));
    await act(async () => view(props).onSelectSession('unknown'));
    expect(props.onRestore).not.toHaveBeenCalled();
    expect(props.history.setActiveEntry).not.toHaveBeenCalled();
    act(() => view(props).onNewChat());
    expect(props.onNew).toHaveBeenCalledOnce();
  });

  it('删除当前任务须确认且存储成功后才清空工作台', async () => {
    const props = options();
    renderHook(() => useImageParseSidebarHistory(props));
    await act(async () => view(props).onDeleteSession('record'));
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
    expect(props.history.remove).toHaveBeenCalledWith('record');
    expect(props.onNew).toHaveBeenCalledOnce();
  });

  it.each([false, true])('取消=%s 或删除失败都保留当前工作台', async (cancelled) => {
    const props = options();
    mocks.confirm.mockResolvedValue(!cancelled);
    props.history.remove.mockResolvedValue(false);
    renderHook(() => useImageParseSidebarHistory(props));
    await act(async () => view(props).onDeleteSession('record'));
    expect(props.history.remove).toHaveBeenCalledTimes(cancelled ? 0 : 1);
    expect(props.onNew).not.toHaveBeenCalled();
  });

  it('确认期间切换账号或项目后不再删除旧范围记录', async () => {
    let approve!: (value: boolean) => void;
    mocks.confirm.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          approve = resolve;
        }),
    );
    const props = options();
    const { rerender } = renderHook((value) => useImageParseSidebarHistory(value), {
      initialProps: props,
    });
    const pending = view(props).onDeleteSession('record');
    rerender({ ...props, scope: 'another:project', attachmentId: undefined });
    await act(async () => {
      approve(true);
      await pending;
    });
    expect(props.history.remove).not.toHaveBeenCalled();
    expect(props.onNew).not.toHaveBeenCalled();
  });

  it('删除期间选择其他文档，成功后不清空新选择的工作台', async () => {
    let finish!: (value: boolean) => void;
    const props = options();
    props.history.remove.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const { rerender } = renderHook((value) => useImageParseSidebarHistory(value), {
      initialProps: props,
    });
    let pending: void | Promise<void>;
    await act(async () => {
      pending = view(props).onDeleteSession('record');
      await Promise.resolve();
    });
    rerender({ ...props, attachmentId: 'other' });
    await act(async () => {
      finish(true);
      await pending;
    });
    expect(props.onNew).not.toHaveBeenCalled();
  });

  it('卸载清除侧栏引用，旧列表回调不能继续操作文档', async () => {
    const props = options();
    const { unmount } = renderHook(() => useImageParseSidebarHistory(props));
    const previous = view(props);
    unmount();
    expect(props.onChange).toHaveBeenLastCalledWith(undefined);
    await act(async () => previous.onSelectSession('record'));
    expect(props.onRestore).not.toHaveBeenCalled();
  });
});
