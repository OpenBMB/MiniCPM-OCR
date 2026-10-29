/** Append pages: selection checks, PDF composition, stale-response isolation, and error notices. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@map/ui';

import type { Attachment } from '../types';
import { isImageParseSharedExample } from '../utils/imageParseExamples';
import {
  appendSelectionError,
  appendedPdfSnapshot,
  imagePageResult,
} from '../utils/appendDocumentPlan';
import { buildAppendedPdf, bytesToDataUrl } from '../utils/appendDocumentPages';
import { isPdfAttachment } from '../utils/documentUpload';
import type { useImageParse } from './useImageParse';
import { uploadImageParseDocument } from '../utils/imageParseUpload';

/** On a public http page crypto.randomUUID throws; appended-page numbers have to be generable on that page. */
function appendId(): string {
  try {
    return `append-${crypto.randomUUID()}`;
  } catch {
    return `append-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

const KNOWN_ERRORS = new Set([
  'documentEmptyFile',
  'documentFileTooLarge',
  'documentPdfFailed',
  'documentUploadFailed',
  'imageParsePdfTooManyPages',
]);

/**
 * Manage append-page tasks for the current document.
 * @param parse current workspace state and the appendDocument entry
 * @returns appending state, the file entry, and the cancel method
 */
export function useImageParseAppend(parse: ReturnType<typeof useImageParse>) {
  const { t } = useTranslation('playground');
  const { toast } = useToast();
  const [appending, setAppending] = useState(false);
  const scope = `${parse.attachment?.id ?? ''}:${parse.mode}`;
  const [resetScope, setResetScope] = useState(scope);
  const active = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const latest = useRef(parse);

  // When the recognition tier or attachment changes, reset the UI synchronously first, then abort the external task in an effect.
  if (resetScope !== scope) {
    setResetScope(scope);
    setAppending(false);
  }

  useEffect(() => {
    latest.current = parse;
  }, [parse]);

  const abort = useCallback(() => {
    generation.current += 1;
    active.current?.abort();
    active.current = null;
  }, []);

  const cancel = useCallback(() => {
    abort();
    setAppending(false);
  }, [abort]);

  // When the recognition tier or attachment changes, a composition that has not finished must be aborted and must not be written back onto the old document.
  useEffect(() => {
    abort();
  }, [abort, scope]);

  useEffect(() => () => abort(), [abort]);

  const appendFiles = useCallback(
    async (files: FileList | readonly File[]) => {
      const errorKey = appendSelectionError(files);
      if (errorKey) {
        toast({ title: t(errorKey), variant: 'error' });
        return;
      }
      const current = latest.current.attachment;
      if (!current || latest.current.mode === 'seal' || latest.current.mode === 'kie') return;
      cancel();
      const controller = new AbortController();
      active.current = controller;
      const run = generation.current;
      setAppending(true);
      try {
        const built = await buildAppendedPdf(current, Array.from(files), controller.signal);
        if (generation.current !== run || latest.current.attachment !== current) return;
        const dataUrl = await bytesToDataUrl(built.bytes);
        if (generation.current !== run || latest.current.attachment !== current) return;
        const kept =
          latest.current.pdf?.snapshot?.results ??
          imagePageResult({
            markdown: latest.current.snapshot?.markdown ?? '',
            blocks: latest.current.snapshot?.layout ?? [],
            source: latest.current.snapshot?.source,
            rotation: latest.current.snapshot?.rotation,
            requestId: latest.current.snapshot?.requestId,
          });
        const next: Attachment = {
          id: isImageParseSharedExample(current.id) ? appendId() : current.id,
          kind: 'file',
          name: isPdfAttachment(current)
            ? current.name
            : `${current.name.replace(/\.[^.]+$/, '')}.pdf`,
          mime: 'application/pdf',
          size: built.bytes.byteLength,
          dataUrl,
        };
        const uploaded = await uploadImageParseDocument(
          new File([new Uint8Array(built.bytes)], next.name, { type: 'application/pdf' }),
          { maxBytes: 20 * 1024 * 1024 },
          controller.signal,
        );
        if (!uploaded.ok || !uploaded.attachment?.fileId) throw new Error('documentUploadFailed');
        if (generation.current !== run || latest.current.attachment !== current) {
          if (uploaded.attachment.dataUrl.startsWith('blob:')) {
            URL.revokeObjectURL(uploaded.attachment.dataUrl);
          }
          return;
        }
        latest.current.appendDocument(
          {
            ...next,
            dataUrl: uploaded.attachment.dataUrl,
            fileId: uploaded.attachment.fileId,
          },
          appendedPdfSnapshot(built.previousPages, built.totalPages, kept),
          { resumeIncomplete: true },
        );
      } catch (failure) {
        if (generation.current !== run) return;
        if (failure instanceof DOMException && failure.name === 'AbortError') return;
        const key = failure instanceof Error ? failure.message : '';
        toast({
          title: t(KNOWN_ERRORS.has(key) ? key : 'documentUploadFailed'),
          variant: 'error',
        });
      } finally {
        if (generation.current === run) {
          active.current = null;
          setAppending(false);
        }
      }
    },
    [cancel, t, toast],
  );

  return { appending, appendFiles, cancelAppend: cancel };
}
