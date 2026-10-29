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
 * Autosave observes only real result changes; after a failure, later reading actions may retry at a limited rate, and a restored record is not uploaded again.
 * @param options current account scope, finished snapshot, and the serial save entry
 * @returns the entry that marks the identity of a restored record
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
    // Before the parent clears the old snapshot, the same result must not be submitted to the new account; only the old scope's restore and retry state is discarded.
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
    // Clear failure eligibility on submit, so a retry that has not returned is not queued again by continuous scrolling.
    observed.failed = undefined;
    void save(snapshot).then((saved) => {
      if (!current() || state.current !== observed) return;
      observed.failed = saved ? undefined : { snapshot, retryAt: Date.now() + RETRY_INTERVAL_MS };
    });
  }, [current, save, snapshot]);
  return setActiveEntry;
}
