import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@map/ui';

import { readCurrentImageParseId, writeCurrentImageParseId } from '../utils/imageParseCurrent';
import { isImageParseSharedExample } from '../utils/imageParseExamples';
import type { useImageParse } from './useImageParse';
import type { UseImageParseHistoryResult } from './useImageParseHistory';
import type { ImageParseSnapshot } from '../utils/imageParseHistoryTypes';

interface ImageParseCurrentRestoreOptions {
  scope: string;
  startFresh: boolean;
  parse: Pick<ReturnType<typeof useImageParse>, 'attachment' | 'restore'>;
  history: Pick<UseImageParseHistoryResult, 'items' | 'loading' | 'setActiveEntry' | 'load'>;
  onRestore: () => void;
  acceptSnapshot?: (snapshot: ImageParseSnapshot) => boolean;
}

/**
 * 刷新恢复当前文档，侧栏主动进入则清空指针并跳过自动恢复；历史记录仍可手动打开。
 * @param options 当前范围、入口意图及历史恢复入口
 * @returns 用户主动选择、上传或清空时取消自动恢复的入口
 */
export function useImageParseCurrentRestore({
  scope,
  startFresh,
  parse: { attachment, restore },
  history: { items, loading, setActiveEntry, load },
  onRestore,
  acceptSnapshot,
}: ImageParseCurrentRestoreOptions) {
  const { t } = useTranslation('playground');
  const { toast } = useToast();
  const autoRestoreScope = useRef<string | undefined>(undefined);
  const request = useRef(0);
  const callbacks = useRef({ restore, setActiveEntry, onRestore, acceptSnapshot });
  useLayoutEffect(() => {
    callbacks.current = { restore, setActiveEntry, onRestore, acceptSnapshot };
  }, [restore, setActiveEntry, onRestore, acceptSnapshot]);
  useEffect(() => {
    request.current++;
    autoRestoreScope.current = startFresh ? scope : undefined;
    if (startFresh) writeCurrentImageParseId(scope, null);
  }, [scope, startFresh]);
  useEffect(() => {
    if (attachment && !isImageParseSharedExample(attachment.id)) {
      writeCurrentImageParseId(scope, attachment.id);
    }
  }, [attachment, scope]);
  useEffect(() => {
    if (loading || attachment || items.length === 0 || autoRestoreScope.current === scope) {
      return;
    }
    const currentId = readCurrentImageParseId(scope);
    if (currentId === null) {
      autoRestoreScope.current = scope;
      return;
    }
    const candidates = currentId
      ? items.filter((item) => item.attachmentId === currentId)
      : items.slice(0, 1);
    let cancelled = false;
    const sequence = ++request.current;
    const record = (async () => {
      if (!candidates.length) return load(currentId!, true);
      // 旧工作台允许同一附件保存不同任务；只在该附件的记录中寻找匹配结果。
      for (const entry of candidates) {
        if (cancelled || sequence !== request.current) return null;
        const value = await load(entry.id);
        if (value && callbacks.current.acceptSnapshot?.(value.snapshot) !== false) return value;
      }
      return null;
    })();
    void record.then((record) => {
      if (cancelled || sequence !== request.current) return;
      autoRestoreScope.current = scope;
      if (!record) return;
      if (callbacks.current.acceptSnapshot?.(record.snapshot) === false) return;
      if (!callbacks.current.restore(record.snapshot)) {
        writeCurrentImageParseId(scope, null);
        toast({ title: t('imageParseHistoryInvalid'), variant: 'error' });
        return;
      }
      callbacks.current.setActiveEntry(record);
      callbacks.current.onRestore();
    });
    return () => {
      cancelled = true;
    };
  }, [attachment, items, loading, load, scope, t, toast]);
  return useCallback(() => {
    request.current++;
    autoRestoreScope.current = scope;
  }, [scope]);
}
