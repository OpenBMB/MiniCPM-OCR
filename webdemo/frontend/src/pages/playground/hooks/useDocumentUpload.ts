/** Remote document-upload lifecycle: replacing cancels the old task, and a failure keeps the file so it can be retried. */
import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ReadAttachmentResult } from '../utils/attachments';
import type { Attachment } from '../types';
import { readPreviewAttachment, type ReadAttachmentOptions } from '../utils/attachments';
import { uploadImageParseDocument } from '../utils/imageParseUpload';
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_IMAGE_TYPES,
  documentFileError,
  normalizeDocumentFile,
  type DocumentFileRules,
} from '../utils/documentUpload';

interface UploadState {
  file?: File;
  pending: boolean;
  error?: string;
}

/** OCR document read config: the local size cap must be passed explicitly, so the generic attachment default does not harm a PDF. */
interface DocumentReadOptions extends ReadAttachmentOptions {
  maxBytes: number;
}

/**
 * Orchestrate the real upload for image parsing, and isolate a stale response when the component unmounts or a new file arrives.
 * @param onReady replace the current attachment after success
 * @param scope account and default-project id; a change cancels the old upload
 * @param onStart clear the old recognition result after the file passes checks
 * @param previewOnly when there is no parsing model, preview locally only and do not upload to the server
 * @param rules format, count, and size bounds of the current recognition tier
 */
export function useDocumentUpload(
  onReady: (attachment: Attachment) => void,
  scope = '',
  onStart?: () => void,
  previewOnly = false,
  rules?: DocumentFileRules,
) {
  const { t } = useTranslation('playground');
  const [state, setState] = useState<UploadState>({ pending: false });
  const active = useRef<AbortController | null>(null);
  const previousScope = useRef(scope);
  const mutation = useMutation({
    // Upload is retried explicitly by the user; do not let the cache keep the document content.
    gcTime: 0,
    retry: false,
    mutationFn: async ({ resultPromise }: { resultPromise: Promise<ReadAttachmentResult> }) => {
      const result = await resultPromise;
      if (!result.ok || !result.attachment)
        throw new Error(result.error || t('documentUploadFailed'));
      return result.attachment;
    },
  });
  const { reset: resetMutation } = mutation;

  useEffect(
    () => () => {
      active.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (previousScope.current === scope) return;
    previousScope.current = scope;
    active.current?.abort();
    active.current = null;
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) {
        resetMutation();
        setState({ pending: false });
      }
    });
    return () => {
      disposed = true;
      active.current?.abort();
    };
  }, [resetMutation, scope]);

  function cancel() {
    active.current?.abort();
    active.current = null;
    mutation.reset();
    setState({ pending: false });
  }

  async function upload(file: File): Promise<Attachment | undefined> {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const error = documentFileError(file, rules);
    if (error) {
      active.current = null;
      mutation.reset();
      setState({ pending: false, error: t(error) });
      return undefined;
    }
    onStart?.();
    setState({ file, pending: true });
    try {
      // Create the upload request before handing it to the mutation to track, so when files are replaced in succession the old request can already respond to abort immediately.
      const normalized = normalizeDocumentFile(file);
      // A failed upload does not enter recognition; only preview mode may avoid the file service.
      const options = {
        maxBytes: rules?.maxBytes ?? DOCUMENT_MAX_BYTES,
        accept: rules?.accept ?? DOCUMENT_IMAGE_TYPES,
      };
      const resultPromise = previewOnly
        ? readPreviewAttachment(normalized, controller.signal, options)
        : readDocumentAttachment(normalized, options, controller.signal);
      const attachment = await mutation.mutateAsync({ resultPromise });
      if (controller.signal.aborted) return undefined;
      onReady(attachment);
      setState({ pending: false });
      return attachment;
    } catch {
      if (controller.signal.aborted) return undefined;
      setState({
        file,
        pending: false,
        // An SDK or upstream message may carry a signed URL; the UI shows only stable copy.
        error: t('documentUploadFailed'),
      });
      return undefined;
    } finally {
      if (active.current === controller) {
        active.current = null;
        mutation.reset();
      }
    }
  }

  return { ...state, upload, cancel, retry: () => state.file && void upload(state.file) };
}

/** OCR original uploads all go through the file service. */
function readDocumentAttachment(file: File, options: DocumentReadOptions, signal: AbortSignal) {
  return uploadImageParseDocument(file, options, signal);
}
