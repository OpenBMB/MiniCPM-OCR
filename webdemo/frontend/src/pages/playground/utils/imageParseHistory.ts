import { sanitizeImageParseSnapshot } from './imageParseHistorySnapshot';
import type {
  ImageParseHistoryEntry,
  ImageParseHistoryScope,
  ImageParseHistoryStorage,
  ImageParseSnapshot,
} from './imageParseHistoryTypes';

export { sanitizeImageParseSnapshot } from './imageParseHistorySnapshot';
export type {
  ImageParseSnapshot,
  PdfImageParseSnapshot,
  ImageParseHistoryEntry,
  ImageParseHistoryScope,
  ImageParseHistoryStorage,
} from './imageParseHistoryTypes';

/** 每个用户/项目最多保存 20 个任务；实际可用空间仍由浏览器决定。 */
export const IMAGE_PARSE_HISTORY_LIMIT = 20;
const DATABASE = 'map-ocr-history';
const STORE = 'tasks';
const STORAGE_UNAVAILABLE = 'ImageParseHistoryStorageUnavailable';

function unavailableStorage(): Error {
  const failure = new Error('imageParseHistoryStorageError');
  failure.name = STORAGE_UNAVAILABLE;
  return failure;
}

/** 返回最新的有限任务列表，不修改调用方数组。 */
export function newestImageParseHistory(
  entries: readonly ImageParseHistoryEntry[],
): ImageParseHistoryEntry[] {
  return [...entries]
    .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
    .slice(0, IMAGE_PARSE_HISTORY_LIMIT);
}

function scopeKey(scope: ImageParseHistoryScope): string {
  if (!scope.userId || !scope.projectId) throw new Error('imageParseHistoryScopeRequired');
  return JSON.stringify([scope.userId, scope.projectId]);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(unavailableStorage());
      return;
    }
    const request = indexedDB.open(DATABASE, 1);
    let failed = false;
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: ['scopeKey', 'id'] });
      store.createIndex('scopeKey', 'scopeKey');
    };
    request.onerror = () => reject(request.error ?? unavailableStorage());
    request.onblocked = () => {
      failed = true;
      reject(unavailableStorage());
    };
    request.onsuccess = () => {
      if (failed) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

function readEntries(rows: unknown[], key: string): ImageParseHistoryEntry[] {
  const entries: ImageParseHistoryEntry[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const value = row as Record<string, unknown>;
    if (
      value.scopeKey !== key ||
      typeof value.id !== 'string' ||
      typeof value.createdAt !== 'number' ||
      !Number.isFinite(value.createdAt)
    )
      continue;
    const snapshot = sanitizeImageParseSnapshot(value.snapshot);
    if (snapshot) entries.push({ id: value.id, createdAt: value.createdAt, snapshot });
  }
  return entries;
}

async function transaction<T>(
  scope: ImageParseHistoryScope,
  mode: IDBTransactionMode,
  action: (
    store: IDBObjectStore,
    key: string,
    done: (result: T) => void,
    abort: (failure: Error) => void,
  ) => void,
): Promise<T> {
  const key = scopeKey(scope);
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    let value: T;
    let actionFailure: Error | undefined;
    const tx = db.transaction(STORE, mode);
    tx.oncomplete = () => {
      db.close();
      resolve(value);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(actionFailure ?? tx.error ?? unavailableStorage());
    };
    try {
      action(
        tx.objectStore(STORE),
        key,
        (result) => {
          value = result;
        },
        (failure) => {
          actionFailure = failure;
          tx.abort();
        },
      );
    } catch (failure) {
      tx.abort();
      db.close();
      reject(failure);
    }
  });
}

/** IndexedDB 本地任务存储；写入与淘汰在同一事务内完成，不访问网络。 */
export const imageParseHistoryStorage: ImageParseHistoryStorage = {
  list: (scope) =>
    transaction(scope, 'readonly', (store, key, done) => {
      const request = store.index('scopeKey').getAll(key);
      request.onsuccess = () =>
        done(newestImageParseHistory(readEntries(request.result as unknown[], key)));
    }),
  save: (scope, value, entryId) => {
    const snapshot = sanitizeImageParseSnapshot(value);
    if (!snapshot) return Promise.reject(new Error('imageParseHistoryInvalidSnapshot'));
    const id = entryId ?? JSON.stringify([snapshot.attachment.id, snapshot.mode]);
    return transaction(scope, 'readwrite', (store, key, done, abort) => {
      const request = store.get([key, id]);
      request.onsuccess = () => {
        const existing = readEntries([request.result], key)[0];
        // 恢复必须写回原任务；已删除或身份不匹配时不重新创建记录。
        if (entryId && (!existing || existing.snapshot.attachment.id !== snapshot.attachment.id)) {
          abort(new Error('imageParseHistoryEntryUnavailable'));
          return;
        }
        const entry: ImageParseHistoryEntry = {
          id,
          createdAt: existing?.createdAt ?? Date.now(),
          snapshot,
        };
        store.put({ ...entry, scopeKey: key });
        const all = store.index('scopeKey').getAll(key);
        all.onsuccess = () => {
          const rows = all.result as Array<{ id: string; createdAt: number }>;
          // 原创建时间决定排序；更新结果和阅读位置不将旧任务移到顶部。
          rows.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
          for (const row of rows.slice(IMAGE_PARSE_HISTORY_LIMIT)) store.delete([key, row.id]);
          done(entry);
        };
      };
    });
  },
  remove: (scope, id) =>
    transaction(scope, 'readwrite', (store, key, done) => {
      store.delete([key, id]);
      done(undefined);
    }),
};

const STORAGE_ACCESS_ERRORS = new Set([
  STORAGE_UNAVAILABLE,
  'SecurityError',
  'QuotaExceededError',
  'UnknownError',
  'InvalidStateError',
  'NotFoundError',
  'VersionError',
  'AbortError',
]);

function storageAccessFailure(failure: unknown): boolean {
  return (
    typeof failure === 'object' &&
    failure !== null &&
    'name' in failure &&
    typeof failure.name === 'string' &&
    STORAGE_ACCESS_ERRORS.has(failure.name)
  );
}

/**
 * 创建单个用户/项目的页面历史会话；持久化不可用时保留临时记录，不清空数据库。
 * @param scope 当前用户与项目
 * @param storage 持久化实现
 * @returns 范围绑定的历史操作及是否仅在当前页面保存
 */
export function createImageParseHistorySession(
  scope: ImageParseHistoryScope,
  storage: ImageParseHistoryStorage,
) {
  let items: ImageParseHistoryEntry[] = [];
  let temporary = false;
  function remember(entry: ImageParseHistoryEntry) {
    items = newestImageParseHistory([entry, ...items.filter((item) => item.id !== entry.id)]);
    return entry;
  }
  return {
    get temporary() {
      return temporary;
    },
    async list() {
      scopeKey(scope);
      if (!temporary) {
        try {
          const persisted = await storage.list(scope);
          // 降级后不再用晚到的数据库读取覆盖页面内的新结果或删除操作。
          if (!temporary) items = persisted;
        } catch {
          temporary = true;
        }
      }
      return items;
    },
    async save(value: ImageParseSnapshot, entryId?: string) {
      scopeKey(scope);
      const snapshot = sanitizeImageParseSnapshot(value);
      if (!snapshot) throw new Error('imageParseHistoryInvalidSnapshot');
      if (!temporary) {
        try {
          const entry =
            entryId === undefined
              ? await storage.save(scope, snapshot)
              : await storage.save(scope, snapshot, entryId);
          return remember(entry);
        } catch (failure) {
          if (!storageAccessFailure(failure)) throw failure;
          temporary = true;
        }
      }
      const id = entryId ?? JSON.stringify([snapshot.attachment.id, snapshot.mode]);
      const existing = items.find((item) => item.id === id);
      if (entryId && (!existing || existing.snapshot.attachment.id !== snapshot.attachment.id))
        throw new Error('imageParseHistoryEntryUnavailable');
      return remember({ id, createdAt: existing?.createdAt ?? Date.now(), snapshot });
    },
    async remove(id: string) {
      scopeKey(scope);
      if (!temporary) {
        try {
          await storage.remove(scope, id);
        } catch (failure) {
          if (!storageAccessFailure(failure)) throw failure;
          temporary = true;
        }
      }
      items = items.filter((item) => item.id !== id);
    },
  };
}
