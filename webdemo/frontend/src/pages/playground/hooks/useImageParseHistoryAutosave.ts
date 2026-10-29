import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

import { sameImageParseHistoryContent } from '../utils/imageParseHistoryContent';
import type { ImageParseHistoryEntry, ImageParseSnapshot } from '../utils/imageParseHistoryTypes';

const RETRY_INTERVAL_MS = 5_000;

interface AutosaveState {
  seen?: ImageParseSnapshot | null;
  skipNextSave: boolean;
  activeAttachmentId?: string;
  failed?: { snapshot: ImageParseSnapshot; retryAt: number };
}

interface ImageParseHistoryAutosaveOptions {
  scopeKey: string;
  enabled: boolean;
  current: () => boolean;
  snapshot?: ImageParseSnapshot | null;
  save: (snapshot: ImageParseSnapshot) => Promise<boolean>;
}

/**
 * 自动存档仅观察实际结果变化；失败后后续阅读操作可限频重试，恢复记录不重复上传。
 * @param options 当前账号范围、已完成快照和串行保存入口
 * @returns 标记恢复记录身份的入口
 */
export function useImageParseHistoryAutosave({
  scopeKey,
  enabled,
  current,
  snapshot,
  save,
}: ImageParseHistoryAutosaveOptions) {
  const state = useRef<AutosaveState>({ skipNextSave: false });
  useLayoutEffect(() => {
    // 父级清除旧快照前不能把同一结果提交到新账号；仅丢弃旧范围的恢复与重试状态。
    state.current = { seen: state.current.seen, skipNextSave: false };
  }, [scopeKey]);
  const setActiveEntry = useCallback(
    (entry: ImageParseHistoryEntry) => {
      if (!enabled || !current()) return;
      state.current.activeAttachmentId = entry.snapshot.attachment.id;
      state.current.skipNextSave =
        state.current.seen?.attachment.id !== entry.snapshot.attachment.id;
    },
    [current, enabled],
  );
  useEffect(() => {
    const observed = state.current;
    if (observed.seen === snapshot) return;
    const previous = observed.seen;
    observed.seen = snapshot;
    const skip =
      !!snapshot && observed.skipNextSave && observed.activeAttachmentId === snapshot.attachment.id;
    if (skip) observed.skipNextSave = false;
    if (!snapshot || skip) return;
    const failed = observed.failed;
    const retry =
      failed &&
      Date.now() >= failed.retryAt &&
      sameImageParseHistoryContent(failed.snapshot, snapshot);
    if (sameImageParseHistoryContent(previous, snapshot) && !retry) return;
    // 提交时清除失败资格，避免未返回的重试因连续滚动再次排队。
    observed.failed = undefined;
    void save(snapshot).then((saved) => {
      if (!current() || state.current !== observed) return;
      observed.failed = saved ? undefined : { snapshot, retryAt: Date.now() + RETRY_INTERVAL_MS };
    });
  }, [current, save, snapshot]);
  return setActiveEntry;
}
