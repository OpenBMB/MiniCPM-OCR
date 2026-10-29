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
 * When switching tasks inside the same file, keep each task's result and draft identity, and do not reuse them across accounts, projects, or attachments.
 * @param options current snapshot, task, and restore entry
 * @returns a task-switch function that does not call the model automatically
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
