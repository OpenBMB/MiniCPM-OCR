import { useLayoutEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useToast } from '@map/ui';
import {
  loadImageParseExampleSnapshot,
  type ImageParseExampleSnapshot,
} from '../utils/imageParseExampleSnapshot';
import {
  IMAGE_PARSE_SHARED_EXAMPLES,
  type ImageParseExampleType,
} from '../utils/imageParseExamples';
import type { ImageParseSnapshot } from '../utils/imageParseHistoryTypes';
import { useImageParseExampleMerge } from './useImageParseExampleMerge';

/**
 * 读取数据库共享案例，并在同一页面会话内复用已校验快照。
 * @param onReady 工作台快照恢复入口
 * @param scope 当前账号和项目范围
 * @param attachmentId 当前附件 ID，用于隔离旧案例的翻页回调
 * @returns 案例加载、取消、忙碌状态及图片组分页
 */
export function useImageParseExamples(
  onReady: (snapshot: ImageParseSnapshot) => boolean,
  scope: string,
  attachmentId?: string,
) {
  const active = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const snapshots = useRef(new Map<string, ImageParseExampleSnapshot>());
  const [group, setGroup] = useState<{
    scope: string;
    id: string;
    revision: number;
    page: number;
    snapshots: readonly ImageParseSnapshot[];
    mergedSnapshots?: readonly ImageParseSnapshot[];
    signal: AbortSignal;
  }>();
  const [selectionRevision, setSelectionRevision] = useState(0);
  const groupRef = useRef(group);
  useLayoutEffect(() => {
    groupRef.current = group;
  }, [group]);
  const current = useRef({ scope, attachmentId, onReady });
  useLayoutEffect(() => {
    if (current.current.scope !== scope) sequence.current++;
    current.current = { scope, attachmentId, onReady };
  }, [scope, attachmentId, onReady]);
  const { t } = useTranslation('playground');
  const { toast } = useToast();
  const restoreSnapshot = (snapshot: ImageParseExampleSnapshot, signal: AbortSignal) => {
    const first = snapshot.imagePages?.[0] ?? snapshot;
    if (signal.aborted || current.current.scope !== scope || !current.current.onReady(first))
      return false;
    if (snapshot.imagePages)
      setGroup({
        scope,
        id: first.attachment.id,
        revision: sequence.current,
        page: 1,
        snapshots: snapshot.imagePages,
        signal,
      });
    setSelectionRevision((revision) => revision + 1);
    return true;
  };
  const cacheKey = (type: ImageParseExampleType) => {
    const example = IMAGE_PARSE_SHARED_EXAMPLES.find((item) => item.type === type);
    return `${type}:${example?.captureVersion}:${example?.url ?? ''}`;
  };
  const mutation = useMutation({
    gcTime: 0,
    retry: false,
    mutationFn: async ({
      type,
      controller,
      revision,
    }: {
      type: ImageParseExampleType;
      controller: AbortController;
      revision: number;
    }) => {
      if (
        controller.signal.aborted ||
        sequence.current !== revision ||
        current.current.scope !== scope
      )
        return;
      try {
        const snapshot = await loadImageParseExampleSnapshot(type, controller.signal);
        controller.signal.throwIfAborted();
        if (!restoreSnapshot(snapshot, controller.signal))
          throw new Error('imageParseExampleLoadFailed');
        snapshots.current.set(cacheKey(type), snapshot);
      } catch {
        if (!controller.signal.aborted && current.current.scope === scope)
          toast({ title: t('imageParseExampleLoadFailed'), variant: 'error' });
      }
    },
  });
  useLayoutEffect(() => () => active.current?.abort(), [scope]);
  const visible =
    group?.scope === scope && group.id === attachmentId && !group.signal.aborted
      ? group
      : undefined;
  const tableMerge = useImageParseExampleMerge(visible?.snapshots, (merged) => {
    const active = groupRef.current;
    if (!visible || !active || active.id !== visible.id || active.revision !== visible.revision)
      return;
    const currentIndex = active.page - 1;
    if (!merged.size) {
      // 取消合并：撤销上一次写回的合并结果；合并请求没有变化时不应改写快照。
      if (!active.mergedSnapshots) return;
      setGroup((previous) => {
        if (previous !== active) return previous;
        const next = { ...previous };
        delete next.mergedSnapshots;
        return next;
      });
      const original = active.snapshots[currentIndex];
      if (original) current.current.onReady(original);
      return;
    }
    const mergedSnapshots = active.snapshots.map((snapshot, index) => {
      const result = merged.get(index);
      return result ? { ...snapshot, markdown: result.markdown, layout: result.blocks } : snapshot;
    });
    setGroup((previous) => (previous === active ? { ...previous, mergedSnapshots } : previous));
    // 只有当前页发生变化时才替换正在展示的结果；其他页在翻页时读取 mergedSnapshots。
    const currentSnapshot = mergedSnapshots[currentIndex];
    if (merged.has(currentIndex) && currentSnapshot) current.current.onReady(currentSnapshot);
  });
  return {
    load: (type: ImageParseExampleType) => {
      active.current?.abort();
      sequence.current++;
      setGroup(undefined);
      // mutation 异步启动前也必须能取消，避免同一事件中的新建/上传被旧案例覆盖。
      const controller = new AbortController();
      active.current = controller;
      const key = cacheKey(type);
      const cached = snapshots.current.get(key);
      if (cached) {
        if (!restoreSnapshot(cached, controller.signal)) {
          snapshots.current.delete(key);
          active.current = null;
          toast({ title: t('imageParseExampleLoadFailed'), variant: 'error' });
        }
        return;
      }
      mutation.mutate({ type, controller, revision: sequence.current });
    },
    pending: mutation.isPending,
    selectionRevision,
    cancel: () => {
      sequence.current++;
      active.current?.abort();
      setGroup(undefined);
    },
    pageKey: visible ? `${visible.id}:${visible.revision}:${visible.page}` : undefined,
    images: visible
      ? {
          page: visible.page,
          pages: visible.snapshots.length,
          attachments: visible.snapshots.map((snapshot) => snapshot.attachment),
          name:
            (visible.mergedSnapshots ?? visible.snapshots)[visible.page - 1]?.attachment.name ?? '',
          tableMerge: visible.snapshots.length > 1 ? tableMerge : undefined,
          setPage: (page: number) => {
            if (
              visible.signal.aborted ||
              current.current.scope !== visible.scope ||
              current.current.attachmentId !== visible.id ||
              sequence.current !== visible.revision ||
              !Number.isInteger(page) ||
              page === visible.page
            )
              return;
            const snapshot = (visible.mergedSnapshots ?? visible.snapshots)[page - 1];
            if (!snapshot || !current.current.onReady(snapshot)) return;
            setGroup((previous) => (previous === visible ? { ...previous, page } : previous));
          },
        }
      : undefined,
  };
}
