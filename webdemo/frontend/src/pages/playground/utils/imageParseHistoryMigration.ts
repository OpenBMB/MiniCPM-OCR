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
    // 浏览器存储不可用不影响云端历史，也不再降级为临时持久化。
    return result;
  }
  for (const entry of [...entries].reverse()) {
    try {
      await saveImageParseHistory(scope, entry.snapshot, undefined, true);
      result.changed = true;
      // 只有服务端确认持久化后才移除这一个账号/项目的旧缓存。
      await imageParseHistoryStorage.remove(scope, entry.id);
    } catch {
      // 单条超限或已删除不能阻断其它有效记录；失败的副本留在原浏览器。
      result.pending = true;
    }
  }
  return result;
}

/** 先确认云端可读，再迁移当前账号的旧记录；失败时保留旧缓存并显示可重试提示。 */
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
