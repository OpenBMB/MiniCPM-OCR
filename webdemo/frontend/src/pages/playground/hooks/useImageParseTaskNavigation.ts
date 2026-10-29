import { useRef, type Dispatch, type SetStateAction } from 'react';

import type { ImageParseMode } from '@/api/map/imageParseSdk';
import type { Attachment } from '../types';
import type { ImageParseSnapshot } from '../utils/imageParseHistory';

interface ImageParseTaskNavigationOptions {
  scope: string;
  attachment?: Attachment;
  mode: ImageParseMode;
  snapshot: ImageParseSnapshot | null;
  restore: (snapshot: ImageParseSnapshot, options?: { finished?: boolean }) => boolean;
  finished: boolean;
  selectMode: (mode: ImageParseMode) => void;
  resultRevision: number;
  setResultRevision: Dispatch<SetStateAction<number>>;
}

/**
 * 同一文件内切换任务时保留各自的结果和草稿身份，不跨账号、项目或附件复用。
 * @param options 当前快照、任务与恢复入口
 * @returns 不自动调用模型的任务切换函数
 */
export function useImageParseTaskNavigation({
  scope,
  attachment,
  mode,
  snapshot,
  restore,
  finished,
  selectMode,
  resultRevision,
  setResultRevision,
}: ImageParseTaskNavigationOptions) {
  const cache = useRef(
    new Map<
      ImageParseMode,
      { snapshot: ImageParseSnapshot; revision: number; finished: boolean }
    >(),
  );
  const boundary = useRef<{ scope: string; id?: string; source?: string } | undefined>(undefined);

  return (next: ImageParseMode) => {
    if (next === mode) return;
    const key = { scope, id: attachment?.id, source: attachment?.dataUrl };
    if (
      boundary.current?.scope !== key.scope ||
      boundary.current?.id !== key.id ||
      boundary.current?.source !== key.source
    ) {
      cache.current.clear();
      boundary.current = key;
    }
    if (snapshot) cache.current.set(mode, { snapshot, revision: resultRevision, finished });
    const saved = cache.current.get(next);
    if (saved && restore(saved.snapshot, { finished: saved.finished })) {
      setResultRevision(saved.revision);
      return;
    }
    selectMode(next);
  };
}
