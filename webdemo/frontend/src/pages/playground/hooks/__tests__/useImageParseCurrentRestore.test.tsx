import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useImageParseCurrentRestore } from '../useImageParseCurrentRestore';
import { readCurrentImageParseId, writeCurrentImageParseId } from '../../utils/imageParseCurrent';
import type { ImageParseHistoryEntry } from '../../utils/imageParseHistoryTypes';

const mocks = vi.hoisted(() => ({
  t: (key: string) => key,
  toast: vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock('@map/ui', () => ({ useToast: () => ({ toast: mocks.toast }) }));
const entry: ImageParseHistoryEntry = {
  id: 'history',
  createdAt: 1,
  snapshot: {
    attachment: {
      id: 'document',
      kind: 'image',
      name: 'scan.png',
      mime: 'image/png',
      size: 1,
      dataUrl: 'data:image/png;base64,YQ==',
    },
    mode: 'scored',
    markdown: '# Saved',
    layout: [],
  },
};
const scope = JSON.stringify(['user', 'project']);

function options() {
  return {
    scope,
    startFresh: false,
    parse: { attachment: undefined, restore: vi.fn().mockReturnValue(true) },
    history: {
      items: [{ id: entry.id, createdAt: 1, name: 'scan.png', attachmentId: 'document' }],
      loading: false,
      setActiveEntry: vi.fn(),
      load: vi.fn<() => Promise<ImageParseHistoryEntry | null>>().mockResolvedValue(entry),
    },
    onRestore: vi.fn(),
  };
}

describe('云端当前文档自动恢复', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.toast.mockClear();
    writeCurrentImageParseId(scope, 'document');
  });

  it('按当前指针读取完整记录，成功恢复后登记原记录身份', async () => {
    const props = options();
    renderHook(() => useImageParseCurrentRestore(props));
    await waitFor(() => expect(props.parse.restore).toHaveBeenCalledWith(entry.snapshot));
    expect(props.history.setActiveEntry).toHaveBeenCalledWith(entry);
    expect(props.onRestore).toHaveBeenCalledOnce();
  });

  it('云端读取失败保留当前指针，不清空用户可重试的历史', async () => {
    const props = options();
    props.history.load.mockResolvedValue(null);
    renderHook(() => useImageParseCurrentRestore(props));
    await waitFor(() => expect(props.history.load).toHaveBeenCalledOnce());
    expect(readCurrentImageParseId(scope)).toBe('document');
    expect(props.parse.restore).not.toHaveBeenCalled();
  });

  it('固定入口拒绝恢复另一任务历史，保留记录且不提示损坏', async () => {
    const props = options();
    renderHook(() =>
      useImageParseCurrentRestore({
        ...props,
        acceptSnapshot: (snapshot) => snapshot.mode === 'kie',
      }),
    );
    await waitFor(() => expect(props.history.load).toHaveBeenCalledOnce());
    expect(props.parse.restore).not.toHaveBeenCalled();
    expect(props.history.setActiveEntry).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(readCurrentImageParseId(scope)).toBe('document');
  });

  it('同一附件有全文和字段历史时，恢复固定入口对应的任务', async () => {
    const props = options();
    const kieEntry: ImageParseHistoryEntry = {
      ...entry,
      id: 'kie-history',
      snapshot: { ...entry.snapshot, mode: 'kie', fields: ['金额'] },
    };
    props.history.items.push({ ...props.history.items[0]!, id: kieEntry.id });
    props.history.load.mockResolvedValueOnce(entry).mockResolvedValueOnce(kieEntry);
    renderHook(() =>
      useImageParseCurrentRestore({
        ...props,
        acceptSnapshot: (snapshot) => snapshot.mode === 'kie',
      }),
    );
    await waitFor(() => expect(props.parse.restore).toHaveBeenCalledWith(kieEntry.snapshot));
    expect(props.parse.restore).toHaveBeenCalledOnce();
    expect(props.history.setActiveEntry).toHaveBeenCalledWith(kieEntry);
  });

  it('用户主动选择或上传后，未完成的自动恢复不能覆盖新操作', async () => {
    const props = options();
    let finish!: (value: ImageParseHistoryEntry) => void;
    props.history.load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useImageParseCurrentRestore(props));
    expect(props.history.load).toHaveBeenCalledOnce();
    act(() => result.current());
    await act(async () => {
      finish(entry);
    });
    expect(props.parse.restore).not.toHaveBeenCalled();
    expect(props.onRestore).not.toHaveBeenCalled();
  });

  it('切换账号后，前一范围的自动恢复响应不会写入新工作台', async () => {
    const props = options();
    let finish!: (value: ImageParseHistoryEntry) => void;
    props.history.load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { rerender } = renderHook((value) => useImageParseCurrentRestore(value), {
      initialProps: props,
    });
    rerender({ ...props, scope: 'another:project', startFresh: true });
    await act(async () => {
      finish(entry);
    });
    expect(props.parse.restore).not.toHaveBeenCalled();
  });
  it('较早的当前文档不在首屏摘要时直接按个人附件身份查找，不丢弃指针', async () => {
    const props = options();
    props.history.items = [{ id: 'newer', createdAt: 2, name: 'new.png', attachmentId: 'newer' }];
    renderHook(() => useImageParseCurrentRestore(props));
    await waitFor(() => expect(props.parse.restore).toHaveBeenCalledWith(entry.snapshot));
    expect(props.history.load).toHaveBeenCalledWith('document', true);
    expect(readCurrentImageParseId(scope)).toBe('document');
  });
});
