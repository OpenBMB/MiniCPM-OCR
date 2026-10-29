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

/** Each user/project saves at most 20 tasks; usable space is still decided by the browser. */
export const IMAGE_PARSE_HISTORY_LIMIT = 20;
const DATABASE = 'map-ocr-history';
const STORE = 'tasks';
const STORAGE_UNAVAILABLE = 'ImageParseHistoryStorageUnavailable';

function unavailableStorage(): Error {
  const failure = new Error('imageParseHistoryStorageError');
  failure.name = STORAGE_UNAVAILABLE;
  return failure;
}

/** Return the latest bounded task list without modifying the caller's array. */
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

/** IndexedDB local task store; writes and eviction finish in the same transaction and do not touch the network. */
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
        // Restore must write back to the original task; do not create a new record when it was deleted or the identity does not match.
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
          // Original creation time decides sort order; updating the result and reading position does not move an old task to the top.
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
 * Create a page-history session for a single user/project; when persistence is unavailable, keep a temporary record and do not clear the database.
 * @param scope current user and project
 * @param storage persistence implementation
 * @returns scope-bound history operations and whether they are saved only for the current page
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
          // After falling back, a late database read must not overwrite a new in-page result or a delete.
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
