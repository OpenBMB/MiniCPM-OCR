import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  deleteImageParseHistory,
  getImageParseHistory,
  saveImageParseHistory,
} from '@/api/map/imageParseHistory';
import { loadImageParseHistoryPage } from '../utils/imageParseHistoryMigration';
import { createImageParseHistoryQueue } from '../utils/imageParseHistoryQueue';
import { invalidateImageParseHistoryRecord } from '../utils/imageParseHistoryCache';
import { useImageParseHistoryAutosave } from './useImageParseHistoryAutosave';
import type {
  ImageParseHistoryEntry,
  ImageParseHistorySummary,
  ImageParseSnapshot,
  UseImageParseHistoryOptions,
  UseImageParseHistoryResult,
} from '../utils/imageParseHistoryTypes';

const EMPTY_HISTORY: ImageParseHistorySummary[] = [];

/** 历史详情短缓存；写入只失效变更记录，手动刷新才失效全部详情。 */
const ENTRY_CACHE = { staleTime: 30_000, gcTime: 120_000 } as const;

export type {
  UseImageParseHistoryOptions,
  UseImageParseHistoryResult,
} from '../utils/imageParseHistoryTypes';

/** 用查询缓存管理云端历史；自动保存串行执行，切换账号后不提交旧范围的排队写入。 */
export function useImageParseHistory({
  userId,
  projectId,
  task = 'standard',
  snapshot,
}: UseImageParseHistoryOptions): UseImageParseHistoryResult {
  const scope = useMemo(
    () => ({ userId: userId ?? '', projectId: projectId ?? '' }),
    [userId, projectId],
  );
  const key = JSON.stringify([userId, projectId, task]);
  const enabled = Boolean(userId && projectId);
  const queryKey = useMemo(
    () => ['image-parse-history', userId, projectId, task],
    [userId, projectId, task],
  );
  const client = useQueryClient();
  const live = useRef(key);
  const mounted = useRef(true);
  const queue = useRef(createImageParseHistoryQueue());
  const [failure, setFailure] = useState<{ key: string; message: string }>();
  useLayoutEffect(() => {
    live.current = key;
    queue.current = createImageParseHistoryQueue();
  }, [key]);
  const current = useCallback(() => mounted.current && live.current === key, [key]);
  const fail = useCallback(
    (error: unknown) => {
      if (current())
        setFailure({
          key,
          message:
            error instanceof Error && error.message === 'imageParseHistoryTooLarge'
              ? error.message
              : 'imageParseHistoryStorageError',
        });
    },
    [current, key],
  );
  const query = useInfiniteQuery({
    queryKey,
    enabled,
    gcTime: 0,
    retry: false,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => loadImageParseHistoryPage(scope, pageParam, signal, task),
    getNextPageParam: (last, pages) =>
      last.hasMore ? pages.reduce((count, page) => count + page.list.length, 0) : undefined,
  });
  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.list) ?? EMPTY_HISTORY,
    [query.data],
  );
  const { fetchNextPage } = query;
  const loadMore = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);
  const { mutateAsync: persist } = useMutation({
    gcTime: 0,
    retry: false,
    mutationFn: ({ value, id }: { value: ImageParseSnapshot; id?: string }) =>
      saveImageParseHistory(scope, value, id),
  });
  const refresh = useCallback(async () => {
    if (enabled && current()) await client.invalidateQueries({ queryKey });
  }, [client, current, enabled, queryKey]);
  const save = useCallback(
    (value: ImageParseSnapshot): Promise<boolean> => {
      const pending = queue.current;
      const saveTask = pending.tail.then(async () => {
        if (
          !enabled ||
          !current() ||
          (value.mode === 'kie') !== (task === 'kie') ||
          queue.current !== pending ||
          pending.deleted.has(value.attachment.id)
        ) {
          return false;
        }
        const active = pending.active;
        const id = active?.attachmentId === value.attachment.id ? active.id : undefined;
        try {
          const saved = await persist({ value, id });
          if (!current()) return false;
          setFailure(undefined);
          await invalidateImageParseHistoryRecord(client, queryKey, saved.id, value.attachment.id);
          return true;
        } catch (error) {
          if (!pending.deleted.has(value.attachment.id)) fail(error);
          return false;
        }
      });
      queue.current.tail = saveTask.then(() => undefined);
      return saveTask;
    },
    [client, current, enabled, fail, persist, queryKey, task],
  );
  const load = useCallback(
    async (id: string, byAttachment = false) => {
      if (!enabled || !current()) return null;
      try {
        const entry = await client.fetchQuery({
          queryKey: [...queryKey, 'entry', byAttachment, id],
          ...ENTRY_CACHE,
          retry: false,
          queryFn: ({ signal }) => getImageParseHistory(scope, id, signal, byAttachment, task),
        });
        return current() ? entry : null;
      } catch (error) {
        fail(error);
        return null;
      }
    },
    [client, current, enabled, fail, queryKey, scope, task],
  );
  const remove = useCallback(
    async (id: string) => {
      if (!enabled || !current()) return false;
      try {
        await deleteImageParseHistory(scope, id);
        if (!current()) return false;
        const item = items.find((entry) => entry.id === id);
        if (item) queue.current.deleted.add(item.attachmentId);
        setFailure(undefined);
        await invalidateImageParseHistoryRecord(client, queryKey, id, item?.attachmentId);
        return true;
      } catch (error) {
        fail(error);
        return false;
      }
    },
    [client, current, enabled, fail, items, queryKey, scope],
  );
  const markRestored = useImageParseHistoryAutosave({
    scopeKey: key,
    enabled,
    current,
    snapshot,
    save,
  });
  const setActiveEntry = useCallback(
    (entry: ImageParseHistoryEntry) => {
      if (!enabled || !current()) return;
      queue.current.active = { id: entry.id, attachmentId: entry.snapshot.attachment.id };
      markRestored(entry);
    },
    [current, enabled, markRestored],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return {
    items: enabled ? items : EMPTY_HISTORY,
    loading: enabled && query.isPending,
    storageError:
      (failure?.key === key ? failure.message : undefined) ??
      (query.isError ? 'imageParseHistoryStorageError' : undefined),
    storageNotice: query.data?.pages.some((page) => page.migrationPending)
      ? 'imageParseHistoryMigrationPending'
      : undefined,
    hasMore: query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    loadMore,
    load,
    save,
    setActiveEntry,
    remove,
    refresh,
  };
}
