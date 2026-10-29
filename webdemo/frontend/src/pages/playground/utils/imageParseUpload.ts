import { fileUploadConfig, uploadPlaygroundFile } from '@/api/map/fileUploads';
import {
  createLocalAttachment,
  readPreviewAttachment,
  type ReadAttachmentOptions,
  type ReadAttachmentResult,
} from './attachments';

/**
 * OCR originals are uploaded only to the file service. PDFs preview with a Blob URL and do not go through the legacy asset path or a local fallback.
 * @param file file that has already passed format and size checks
 * @param options document format and size bounds
 * @param signal upload lifecycle
 * @returns stable fileId and local preview; on failure, do not return an attachment that can be recognized
 */
export async function uploadImageParseDocument(
  file: File,
  options: ReadAttachmentOptions,
  signal: AbortSignal,
): Promise<ReadAttachmentResult> {
  signal.throwIfAborted();
  const config = await fileUploadConfig();
  signal.throwIfAborted();
  if (!config.enabled || !config.project_id) throw new Error('imageParseFileServiceUnavailable');
  const fileId = await uploadPlaygroundFile(file, config.project_id, signal);
  signal.throwIfAborted();
  if (!fileId?.trim()) throw new Error('imageParseFileReferenceUploadFailed');
  if (file.type === 'application/pdf') {
    return {
      ok: true,
      attachment: createLocalAttachment(file, URL.createObjectURL(file), { fileId }),
    };
  }
  const preview = await readPreviewAttachment(file, signal, options);
  if (!preview.ok || !preview.attachment) return preview;
  return { ok: true, attachment: { ...preview.attachment, fileId } };
}
