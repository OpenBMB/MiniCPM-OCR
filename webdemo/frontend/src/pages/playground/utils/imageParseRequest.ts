import {
  IMAGE_PARSE_DEFAULT_MODE,
  validateImageParseSdkResult,
  type ImageParseMode,
  type ImageParseSdkResult,
} from '@/api/map/imageParseSdk';
import { getDemoUpload } from '@/api/map/demoStore';
import { parseImageV2 } from '@/api/map/imageParseV2';

import type { Attachment } from '../types';
import { isDocumentImageDataURL } from './documentUpload';

interface ImageParseRun {
  attachment: Attachment;
  signal: AbortSignal;
  isCurrent: () => boolean;
  mode?: ImageParseMode;
  /** Document-parsing model ID visible to the current logged-in user; an empty value means no permission. */
  model: string;
  /** Plaintext secret of the currently selected API Key; passed in memory only and not persisted to disk. */
  secret: string;
  /** A Playground single image prefers an OBS file reference; when the file service fails, fall back to an inline image. */
  fileId?: string;
  /** When the file service is unavailable, use the signed URL returned by the platform's legacy asset entry. */
  fileUrl?: string;
}

/** Parse the page image through the L2 API Key path; do not judge L2 availability from the L3 proxy config, and do not fall back to a traditional model. */
export async function runImageParse(args: ImageParseRun): Promise<ImageParseSdkResult | undefined> {
  const signal = AbortSignal.any([args.signal, AbortSignal.timeout(300_000)]);
  const assertCurrent = () => {
    signal.throwIfAborted();
    if (!args.isCurrent()) throw new DOMException('Recognition cancelled', 'AbortError');
  };
  assertCurrent();
  if (!args.model?.trim()) throw new Error('imageParseNoModel');
  // An explicitly passed empty string means this attempt must use an inline image and must not fall back to the attachment,
  // or an inline retry after the reference failed would attach the fileId/URL that was already cleared.
  const fileId =
    args.fileId !== undefined ? args.fileId.trim() : (args.attachment.fileId?.trim() ?? '');
  const fileUrl =
    args.fileUrl !== undefined ? args.fileUrl.trim() : (args.attachment.publicUrl?.trim() ?? '');
  if (!fileId && !fileUrl && !isDocumentImageDataURL(args.attachment.dataUrl)) {
    throw new Error('imageParseUploadRequired');
  }
  if ([fileId, fileUrl].filter(Boolean).length > 1) {
    throw new Error('imageParseInvalidRequest');
  }
  let payload: { fileId: string } | { fileUrl: string } | { image: string };
  const demoFile = fileId ? getDemoUpload(fileId) : undefined;
  if (demoFile && demoFile.type !== 'application/pdf') {
    payload = { image: await fileToDataUrl(demoFile) };
  } else if (fileId) {
    payload = { fileId };
  } else if (fileUrl) {
    payload = { fileUrl };
  } else {
    payload = { image: args.attachment.dataUrl };
  }
  const result = await parseImageV2(
    payload,
    args.mode ?? IMAGE_PARSE_DEFAULT_MODE,
    signal,
    0,
    args.model.trim(),
    args.secret,
  );
  assertCurrent();
  return validateImageParseSdkResult(result);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('imageParseUploadRequired'));
    reader.readAsDataURL(file);
  });
}

/** Turn a parse error key into a UI copy key; a high-precision tier timeout uses a more specific notice. */
export function imageParseCopyKey(key: string, mode: ImageParseMode): string {
  return key === 'imageParseTimeout' && mode === 'high-precision'
    ? 'imageParseHighPrecisionTimeout'
    : key;
}

/** Turn a v3 OCR proxy error into a stable copy key, and do not show an unsanitized upstream message. */
export function imageParseErrorKey(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'imageParseTimeout';
  if (error instanceof Error && /^imageParse[A-Z]/.test(error.message)) return error.message;
  return 'imageParseRequestFailed';
}
