import { afterEach, describe, expect, it, vi } from 'vitest';
import { createImageParseHistorySession, imageParseHistoryStorage } from './imageParseHistory';

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

function interruptedDatabase(missingEntry = false) {
  const get = { result: undefined, onsuccess: null } as unknown as IDBRequest;
  const tx = {
    error: null,
    abort: vi.fn(() => queueMicrotask(() => tx.onabort?.(new Event('abort')))),
    objectStore: () => ({
      get: () => {
        if (missingEntry) queueMicrotask(() => get.onsuccess?.(new Event('success')));
        else tx.abort();
        return get;
      },
      transaction: tx,
    }),
    onabort: null as ((event: Event) => void) | null,
  };
  const close = vi.fn();
  const request = {
    result: { transaction: () => tx, close },
    onsuccess: null as ((event: Event) => void) | null,
  };
  vi.stubGlobal('indexedDB', {
    open: () => {
      queueMicrotask(() => request.onsuccess?.(new Event('success')));
      return request;
    },
  });
  return { close };
}

describe('OCR 本地事务失败分类', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('无错误码的事务中断也进入临时保存，不误报本地历史完全不可用', async () => {
    const db = interruptedDatabase();
    const session = createImageParseHistorySession(scope, imageParseHistoryStorage);
    const saved = await session.save(snapshot);
    expect(session.temporary).toBe(true);
    expect(await session.list()).toEqual([saved]);
    expect(db.close).toHaveBeenCalledOnce();
  });

  it('被删除或身份不匹配的恢复记录仍拒绝保存，不误降级后重新创建', async () => {
    const db = interruptedDatabase(true);
    const session = createImageParseHistorySession(scope, imageParseHistoryStorage);
    await expect(session.save(snapshot, 'deleted-entry')).rejects.toThrow(
      'imageParseHistoryEntryUnavailable',
    );
    expect(session.temporary).toBe(false);
    expect(db.close).toHaveBeenCalledOnce();
  });
});
