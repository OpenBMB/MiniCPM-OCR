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
 * Restore the current document on refresh; entering on purpose from the sidebar clears the pointer and skips automatic restore. History records can still be opened manually.
 * @param options current scope, entry intent, and the history-restore entry
 * @returns the entry that cancels automatic restore when the user selects, uploads, or clears on purpose
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
      // The old workspace allowed the same attachment to save different tasks; look for a matching result only among that attachment's records.
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
