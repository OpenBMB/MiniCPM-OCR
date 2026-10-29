import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { confirm } from '@map/ui';
import type { PlaygroundSidebarHistory } from '../components/PlaygroundHistoryList';
import type { ImageParseHistoryEntry } from '../utils/imageParseHistory';
import {
  IMAGE_PARSE_SHARED_EXAMPLES,
  type ImageParseExampleType,
} from '../utils/imageParseExamples';
import type { UseImageParseHistoryResult } from './useImageParseHistory';

interface ImageParseSidebarHistoryOptions {
  scope: string;
  attachmentId?: string;
  history: UseImageParseHistoryResult;
  onRestore: (entry: ImageParseHistoryEntry) => boolean;
  onNew: () => void;
  onSelectIntent?: () => void;
  onExample?: (type: ImageParseExampleType) => void;
  onChange?: (history: PlaygroundSidebarHistory | undefined) => void;
}

/** 固定共享案例与个人云端历史分组；打开记录时按需加载，并隔离过期选择响应。 */
export function useImageParseSidebarHistory(options: ImageParseSidebarHistoryOptions) {
  const { t } = useTranslation('playground');
  const { scope, attachmentId, history, onChange } = options;
  const current = useRef<ImageParseSidebarHistoryOptions | undefined>(options);
  const previousScope = useRef<string | undefined>(undefined);
  const request = useRef(0);
  const [pendingSessionId, setPendingSessionId] = useState<string>();
  const [selection, setSelection] = useState<{
    scope: string;
    id: string;
    attachmentId: string;
  }>();
  useLayoutEffect(() => {
    if (previousScope.current !== undefined && previousScope.current !== scope) {
      request.current++;
      setPendingSessionId(undefined);
    }
    previousScope.current = scope;
  }, [scope]);
  useLayoutEffect(() => {
    current.current = options;
  });
  const onSelectSession = useCallback(async (id: string) => {
    const live = current.current;
    if (!live) return;
    const sequence = ++request.current;
    const example = IMAGE_PARSE_SHARED_EXAMPLES.find((item) => item.id === id);
    if (example) {
      setPendingSessionId(undefined);
      live.onSelectIntent?.();
      live.onExample?.(example.type);
      setSelection(undefined);
      return;
    }
    setPendingSessionId(id);
    try {
      if (!live.history.items.some((item) => item.id === id)) return;
      live.onSelectIntent?.();
      const entry = await live.history.load(id);
      const latest = current.current;
      if (
        !entry ||
        !latest ||
        sequence !== request.current ||
        latest.scope !== live.scope ||
        latest.attachmentId !== live.attachmentId ||
        !latest.onRestore(entry)
      )
        return;
      latest.history.setActiveEntry(entry);
      setSelection({ scope: latest.scope, id, attachmentId: entry.snapshot.attachment.id });
    } finally {
      if (sequence === request.current) setPendingSessionId(undefined);
    }
  }, []);
  const onNewChat = useCallback(() => {
    request.current++;
    setPendingSessionId(undefined);
    current.current?.onNew();
    setSelection(undefined);
  }, []);
  const onDeleteSession = useCallback(
    async (id: string) => {
      const live = current.current;
      const entry = live?.history.items.find((item) => item.id === id);
      if (!live || !entry) return;
      const approved = await confirm({
        title: t('imageParseHistoryDeleteConfirmTitle'),
        description: t('imageParseHistoryDeleteConfirmDescription', {
          name: entry.name,
        }),
        confirmText: t('delete'),
        variant: 'destructive',
      });
      if (!approved || current.current?.scope !== live.scope) return;
      const removed = await live.history.remove(id);
      const latest = current.current;
      if (!removed || latest?.scope !== live.scope) return;
      if (latest.attachmentId === entry.attachmentId) {
        request.current++;
        setPendingSessionId(undefined);
        latest.onNew();
        setSelection(undefined);
      }
    },
    [t],
  );
  const selected = selection?.scope === scope && selection.attachmentId === attachmentId;
  const activeSessionId =
    IMAGE_PARSE_SHARED_EXAMPLES.find((item) => item.id === attachmentId)?.id ??
    (selected
      ? history.items.find((entry) => entry.id === selection.id)?.id
      : history.items.find((entry) => entry.attachmentId === attachmentId)?.id);
  useLayoutEffect(() => {
    onChange?.({
      sessions: [
        ...IMAGE_PARSE_SHARED_EXAMPLES.map((example) => ({
          id: example.id,
          title: t(example.label),
          category: 'example' as const,
        })),
        ...history.items.map((entry) => ({ id: entry.id, title: entry.name })),
      ],
      activeSessionId,
      pendingSessionId,
      loading: history.loading,
      storageError: history.storageError,
      storageNotice: history.storageNotice,
      hasMore: history.hasMore,
      loadingMore: history.loadingMore,
      onLoadMore: history.loadMore,
      onSelectSession,
      onDeleteSession,
      onNewChat,
    });
  }, [
    activeSessionId,
    pendingSessionId,
    history.items,
    history.loading,
    history.storageError,
    history.storageNotice,
    history.hasMore,
    history.loadingMore,
    history.loadMore,
    onChange,
    onDeleteSession,
    onNewChat,
    onSelectSession,
    scope,
    t,
  ]);
  useLayoutEffect(
    () => () => {
      current.current = undefined;
      onChange?.(undefined);
    },
    [onChange],
  );
  return useCallback(() => {
    request.current++;
  }, []);
}
