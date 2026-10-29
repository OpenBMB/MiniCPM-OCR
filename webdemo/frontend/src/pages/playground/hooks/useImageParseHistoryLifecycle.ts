import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { ImageParseMode } from '@/api/map/imageParseSdk';
import type { ImageParseSource } from '@/api/map/imageParseSource';

import type { Attachment } from '../types';
import type { ImageParseLayoutBlock } from '../utils/imageParseSample';
import type { ImageParseRotationInfo } from '../utils/imageParseSample';
import type { ImageParseSnapshot, PdfImageParseSnapshot } from '../utils/imageParseHistory';
import { isImageParseSharedExample } from '../utils/imageParseExamples';
import { imageParseKieFieldsError } from '../utils/imageParseKie';

interface ImageParseHistoryLifecycleOptions {
  scope: string;
  mode: ImageParseMode;
  attachment?: Attachment;
  loading: boolean;
  cancel: () => void;
  setImage: (attachment?: Attachment) => void;
  parse: () => Promise<void>;
  pendingAuto: MutableRefObject<boolean>;
}

/**
 * Cancel the old task when the scope or mode changes; a cache restore can update the valid scope synchronously without running recognition again.
 * @param options current task scope, state, and the cancel/recognition entries
 * @returns the snapshot-valid flag and the function that updates the restore boundary
 */
export function useImageParseHistoryLifecycle({
  scope,
  mode,
  attachment,
  loading,
  cancel,
  setImage,
  parse,
  pendingAuto,
}: ImageParseHistoryLifecycleOptions) {
  const previousRef = useRef({ scope, mode });
  const [boundary, setBoundary] = useState({ scope, mode });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const old = previousRef.current;
    previousRef.current = { scope, mode };
    const changed = old.scope !== scope;
    if (!changed && old.mode === mode) return;
    cancel();
    let disposed = false;
    queueMicrotask(() => {
      if (disposed) return;
      setImage(changed ? undefined : attachment);
      setBoundary({ scope, mode });
      if (!changed) setRevision((value) => value + 1);
    });
    return () => {
      disposed = true;
    };
  }, [attachment, cancel, mode, scope, setImage]);
  useEffect(() => {
    if (!pendingAuto.current || loading || !attachment) return;
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed && pendingAuto.current) void parse();
    });
    return () => {
      disposed = true;
    };
  }, [attachment, revision, loading, parse, pendingAuto]);
  useEffect(() => () => cancel(), [cancel]);
  const restoreBoundary = useCallback(
    (mode: ImageParseMode) => {
      previousRef.current = { scope, mode };
      setBoundary({ scope, mode });
    },
    [scope],
  );
  return { valid: boundary.scope === scope && boundary.mode === mode, restoreBoundary };
}

interface ImageParseHistorySnapshotOptions {
  attachment?: Attachment;
  mode: ImageParseMode;
  fields?: readonly string[];
  markdown: string;
  layout: readonly ImageParseLayoutBlock[];
  source?: ImageParseSource;
  rotation?: ImageParseRotationInfo;
  finished: boolean;
  loading: boolean;
  error?: string;
  valid: boolean;
  pdfActive: boolean;
  pdf: PdfImageParseSnapshot | null;
}

const EMPTY_LAYOUT: readonly ImageParseLayoutBlock[] = [];

/**
 * Derive a snapshot that can be saved immediately after upload; while it is unfinished, keep only the original, and continue recognition after it is opened again.
 * @param options recognition result and the valid state of the current task
 * @returns an image/PDF snapshot that can be saved; null for a shared example or when the scope is no longer valid
 */
export function useImageParseHistorySnapshot({
  attachment,
  mode,
  fields,
  markdown,
  layout,
  source,
  rotation,
  finished,
  loading,
  error,
  valid,
  pdfActive,
  pdf,
}: ImageParseHistorySnapshotOptions): ImageParseSnapshot | null {
  return useMemo(() => {
    if (!attachment || !valid || isImageParseSharedExample(attachment.id)) return null;
    if (pdfActive && mode === 'seal') return null;
    // The backend requires a kie snapshot to carry legal fields; do not create or overwrite history before the fields are filled in.
    if (mode === 'kie' && imageParseKieFieldsError(fields ?? [])) return null;
    if (pdfActive) {
      if (!pdf) return null;
      const current = pdf.results[pdf.page]?.result;
      return {
        attachment,
        mode,
        markdown: current?.markdown ?? '',
        layout: current?.blocks ?? [],
        rotation: current?.rotation,
        ...(mode === 'kie' && fields?.length ? { fields: [...fields] } : {}),
        pdf,
      };
    }
    return finished && !loading && !error
      ? {
          attachment,
          mode,
          markdown,
          layout,
          ...(mode === 'kie' && fields?.length ? { fields: [...fields] } : {}),
          ...(source ? { source } : {}),
          ...(rotation ? { rotation } : {}),
        }
      : {
          attachment,
          mode,
          markdown: '',
          layout: EMPTY_LAYOUT,
          ...(mode === 'kie' && fields?.length ? { fields: [...fields] } : {}),
        };
  }, [
    attachment,
    mode,
    fields,
    markdown,
    layout,
    source,
    rotation,
    finished,
    loading,
    error,
    valid,
    pdfActive,
    pdf,
  ]);
}
