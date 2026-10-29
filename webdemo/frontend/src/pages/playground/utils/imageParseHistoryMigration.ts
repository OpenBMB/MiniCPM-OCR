import {
  listImageParseHistory,
  saveImageParseHistory,
  type ImageParseHistoryTask,
  type ImageParseHistoryPage,
} from '@/api/map/imageParseHistory';
import { imageParseHistoryStorage } from './imageParseHistory';
import type { ImageParseHistoryScope } from './imageParseHistoryTypes';

interface MigrationResult {
  changed: boolean;
  pending: boolean;
}
const migrations = new Map<string, Promise<MigrationResult>>();

async function migrate(scope: ImageParseHistoryScope): Promise<MigrationResult> {
  const result = { changed: false, pending: false };
  let entries;
  try {
    entries = await imageParseHistoryStorage.list(scope);
  } catch {
    // Browser storage being unavailable does not affect cloud history, and it no longer falls back to temporary persistence.
    return result;
  }
  for (const entry of [...entries].reverse()) {
    try {
      await saveImageParseHistory(scope, entry.snapshot, undefined, true);
      result.changed = true;
      // Remove the old cache for this one account/project only after the server confirms it was persisted.
      await imageParseHistoryStorage.remove(scope, entry.id);
    } catch {
      // One record over the limit or already deleted must not block other valid records; the failed copy stays in the original browser.
      result.pending = true;
    }
  }
  return result;
}

/** Confirm the cloud copy is readable first, then migrate old records for the current account; on failure keep the old cache and show a retryable notice. */
export async function loadImageParseHistoryPage(
  scope: ImageParseHistoryScope,
  offset: number,
  signal?: AbortSignal,
  task?: ImageParseHistoryTask,
): Promise<ImageParseHistoryPage> {
  const page = await listImageParseHistory(scope, offset, signal, task);
  if (offset) return page;
  const key = JSON.stringify([scope.userId, scope.projectId]);
  let pending = migrations.get(key);
  if (!pending) {
    pending = migrate(scope);
    migrations.set(key, pending);
  }
  try {
    const result = await pending;
    if (result.pending) migrations.delete(key);
    else migrations.set(key, Promise.resolve({ changed: false, pending: false }));
    signal?.throwIfAborted();
    const current = result.changed
      ? await listImageParseHistory(scope, offset, signal, task)
      : page;
    return result.pending ? { ...current, migrationPending: true } : current;
  } catch {
    migrations.delete(key);
    signal?.throwIfAborted();
    return { ...page, migrationPending: true };
  }
}
