import { uploadPlaygroundFile } from '@/api/map/fileUploads';

import type { Attachment } from '../types';
import { isDocumentImageDataURL, isPdfAttachment } from './documentUpload';

/** The only original reference in the OCR workspace is the file-service fileId. */
export interface ImageParseFileReference {
  fileId: string;
}

/** Turn an OCR local preview back into an uploadable file; used only to fill in a missing OBS file reference. */
function imageDataURLToFile(attachment: Attachment): File {
  const comma = attachment.dataUrl.indexOf(',');
  if (comma < 0) throw new Error('imageParseFileReferenceRequired');
  const metadata = attachment.dataUrl.slice('data:'.length, comma);
  const payload = attachment.dataUrl.slice(comma + 1).replace(/\s+/g, '');
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const mime = attachment.mime || metadata.split(';')[0] || 'image/png';
  return new File([bytes], attachment.name || 'ocr-image', { type: mime });
}

/**
 * Turn a runtime attachment back into an uploadable file; images use a local data URL, and PDFs may use a short-lived preview link.
 * @param attachment original currently on display
 * @param signal cancellation signal
 * @returns a File that can be handed to the file service
 */
export async function imageParseAttachmentFile(
  attachment: Attachment,
  signal: AbortSignal,
): Promise<File> {
  signal.throwIfAborted();
  if (isPdfAttachment(attachment)) {
    if (!attachment.dataUrl) throw new Error('imageParseFileReferenceRequired');
    const response = await fetch(attachment.dataUrl, { signal });
    if (!response.ok) throw new Error('imageParseFileReferenceUploadFailed');
    const blob = await response.blob();
    signal.throwIfAborted();
    return new File([blob], attachment.name || 'document.pdf', { type: 'application/pdf' });
  }
  if (
    attachment.kind !== 'image' ||
    !isDocumentImageDataURL(attachment.dataUrl) ||
    !attachment.dataUrl
  ) {
    throw new Error('imageParseFileReferenceRequired');
  }
  return imageDataURLToFile(attachment);
}

interface EnsureImageParseFileReferenceOptions {
  attachment: Attachment;
  projectId: string;
  signal: AbortSignal;
}

/**
 * Return an OBS file reference that can be used for OCR.
 * A new upload usually already has a fileId; old history, or a temporary file-service failure, re-uploads once from the local preview.
 * @param options current attachment, project, and cancellation signal
 * @returns file-service fileId; throws a stable error key when it cannot be re-uploaded
 */
export async function ensureImageParseFileReference({
  attachment,
  projectId,
  signal,
}: EnsureImageParseFileReferenceOptions): Promise<ImageParseFileReference> {
  signal.throwIfAborted();
  const existing = attachment.fileId?.trim() ?? '';
  if (existing) return { fileId: existing };
  const pdf = isPdfAttachment(attachment);
  if (
    !pdf &&
    (attachment.kind !== 'image' ||
      !isDocumentImageDataURL(attachment.dataUrl) ||
      !attachment.dataUrl)
  ) {
    throw new Error('imageParseFileReferenceRequired');
  }
  if (!projectId) throw new Error('imageParseFileReferenceUploadFailed');
  try {
    const file = await imageParseAttachmentFile(attachment, signal);
    const fileId = await uploadPlaygroundFile(file, projectId, signal);
    signal.throwIfAborted();
    if (!fileId?.trim()) throw new Error('imageParseFileReferenceUploadFailed');
    return { fileId };
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    // An upload error may contain an upstream signed URL or an internal address; the UI is shown only stable copy.
    throw Object.assign(new Error('imageParseFileReferenceUploadFailed'), { cause: error });
  }
}
