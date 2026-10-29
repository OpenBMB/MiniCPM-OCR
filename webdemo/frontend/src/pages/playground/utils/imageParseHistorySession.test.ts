import { describe, expect, it, vi } from 'vitest';
import {
  createImageParseHistorySession,
  IMAGE_PARSE_HISTORY_LIMIT,
  imageParseHistoryStorage,
  type ImageParseHistoryEntry,
  type ImageParseHistoryStorage,
} from './imageParseHistory';

const scope = { userId: 'user', projectId: 'project' };
const snapshot = {
  attachment: {
    id: 'doc',
    kind: 'image' as const,
    name: 'scan.png',
    mime: 'image/png',
    size: 12,
    dataUrl: 'data:image/png;base64,AAA',
  },
  mode: 'scored' as const,
  markdown: '# Saved',
  layout: [],
};
const entry = { id: 'history', createdAt: 1, snapshot };

function deniedStorage(): ImageParseHistoryStorage {
  const failure = new DOMException('Storage denied', 'SecurityError');
  return {
    list: vi.fn().mockRejectedValue(failure),
    save: vi.fn().mockRejectedValue(failure),
    remove: vi.fn().mockRejectedValue(failure),
  };
}

describe('OCR 页面历史降级', () => {
  it('浏览器未提供 IndexedDB 时真实存储降级，任务仅在当前会话保留', async () => {
    const session = createImageParseHistorySession(scope, imageParseHistoryStorage);
    expect(await session.list()).toEqual([]);
    expect(session.temporary).toBe(true);
    const saved = await session.save(snapshot);
    expect(await session.list()).toEqual([saved]);
    const next = createImageParseHistorySession(scope, imageParseHistoryStorage);
    expect(await next.list()).toEqual([]);
  });

  it('首次读取完成前就保存结果，也能在 IndexedDB 不可用时降级', async () => {
    const session = createImageParseHistorySession(scope, imageParseHistoryStorage);
    const saved = await session.save(snapshot);
    expect(session.temporary).toBe(true);
    expect(await session.list()).toEqual([saved]);
  });

  it('正常持久化仍使用原用户/项目与记录身份，不进入临时模式', async () => {
    const storage = {
      list: vi.fn().mockResolvedValue([entry]),
      save: vi.fn().mockResolvedValue(entry),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const session = createImageParseHistorySession(scope, storage);
    expect(await session.list()).toEqual([entry]);
    await session.save(snapshot, entry.id);
    expect(storage.save).toHaveBeenCalledWith(scope, snapshot, entry.id);
    await session.remove(entry.id);
    expect(storage.remove).toHaveBeenCalledWith(scope, entry.id);
    expect(session.temporary).toBe(false);
  });

  it('读取成功后写入事务被浏览器中断，保留已读历史并临时保存新结果', async () => {
    const storage = {
      list: vi.fn().mockResolvedValue([entry]),
      save: vi.fn().mockRejectedValue(new DOMException('Transaction aborted', 'AbortError')),
      remove: vi.fn(),
    };
    const session = createImageParseHistorySession(scope, storage);
    await session.list();
    const saved = await session.save({
      ...snapshot,
      attachment: { ...snapshot.attachment, id: 'new-document' },
    });
    expect(session.temporary).toBe(true);
    expect(await session.list()).toEqual([saved, entry]);
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('删除事务中断时仅移除当前页面的记录，不清空持久化历史', async () => {
    const storage = {
      list: vi.fn().mockResolvedValue([entry]),
      save: vi.fn(),
      remove: vi.fn().mockRejectedValue(new DOMException('Transaction aborted', 'AbortError')),
    };
    const session = createImageParseHistorySession(scope, storage);
    await session.list();
    await session.remove(entry.id);
    expect(session.temporary).toBe(true);
    expect(await session.list()).toEqual([]);
    expect(storage.remove).toHaveBeenCalledExactlyOnceWith(scope, entry.id);
  });

  it('降级继续执行快照白名单校验，不保留附件签链但保留稳定 fileId', async () => {
    const session = createImageParseHistorySession(scope, deniedStorage());
    await session.list();
    const saved = await session.save({
      ...snapshot,
      attachment: {
        ...snapshot.attachment,
        url: 'https://private.example/signed-url',
        fileId: 'file_pdf',
      },
    });
    expect(saved.snapshot.attachment).toEqual({
      ...snapshot.attachment,
      fileId: 'file_pdf',
    });
    expect(JSON.stringify(await session.list())).not.toContain('private.example');
    await expect(
      session.save({
        ...snapshot,
        attachment: { ...snapshot.attachment, dataUrl: 'https://private.example/remote' },
      }),
    ).rejects.toThrow('imageParseHistoryInvalidSnapshot');
  });

  it('临时历史仍限量保留，更新被删除的任务不会重新创建记录', async () => {
    const session = createImageParseHistorySession(scope, deniedStorage());
    await session.list();
    for (let index = 0; index < IMAGE_PARSE_HISTORY_LIMIT + 1; index++) {
      await session.save({
        ...snapshot,
        attachment: { ...snapshot.attachment, id: `doc-${index}` },
      });
    }
    expect(await session.list()).toHaveLength(IMAGE_PARSE_HISTORY_LIMIT);
    const latest = (await session.list())[0];
    await session.remove(latest.id);
    await expect(session.save(latest.snapshot, latest.id)).rejects.toThrow(
      'imageParseHistoryEntryUnavailable',
    );
    expect(await session.list()).toHaveLength(IMAGE_PARSE_HISTORY_LIMIT - 1);
  });

  it('晚到的持久化读取不能覆盖降级后新建及删除的临时记录', async () => {
    let finishRead!: (items: ImageParseHistoryEntry[]) => void;
    const storage = deniedStorage();
    storage.list = vi.fn(
      () =>
        new Promise<ImageParseHistoryEntry[]>((resolve) => {
          finishRead = resolve;
        }),
    );
    const session = createImageParseHistorySession(scope, storage);
    const pending = session.list();
    const saved = await session.save(snapshot);
    await session.remove(saved.id);
    const replacement = await session.save({
      ...snapshot,
      attachment: { ...snapshot.attachment, id: 'replacement' },
    });
    finishRead([entry]);
    expect(await pending).toEqual([replacement]);
    expect(await session.list()).toEqual([replacement]);
  });

  it('缺少用户或项目时不创建匿名临时历史', async () => {
    const storage = deniedStorage();
    const session = createImageParseHistorySession({ userId: '', projectId: 'project' }, storage);
    await expect(session.list()).rejects.toThrow('imageParseHistoryScopeRequired');
    await expect(session.save(snapshot)).rejects.toThrow('imageParseHistoryScopeRequired');
    expect(storage.list).not.toHaveBeenCalled();
    expect(storage.save).not.toHaveBeenCalled();
    expect(session.temporary).toBe(false);
  });
});
