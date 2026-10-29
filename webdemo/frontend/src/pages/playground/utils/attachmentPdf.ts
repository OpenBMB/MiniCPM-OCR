import { fileUploadConfig, uploadPlaygroundFile } from '@/api/map/fileUploads';
import {
  createLocalAttachment,
  readFileAsAttachment,
  type ReadAttachmentOptions,
  type ReadAttachmentResult,
} from './attachments';

const PDF_MIME = 'application/pdf';

/**
 * Read an OCR PDF: when the file service is available, upload the original first, then preview it with a runtime Blob URL.
 *
 * A large PDF must not be converted to a base64 data URL first; otherwise both FileReader and PDF.js decoding occupy the main thread for a long time.
 * The Blob URL lives only in the current attachment state. Cloud history still persists only the stable fileId.
 * @param file PDF selected by the user
 * @param signal cancellation signal when files are replaced in succession
 * @param options OCR size limit and local-fallback policy
 * @returns fileId + Blob URL on a successful upload; the local fallback also uses a Blob URL so base64 does not block the main thread
 */
export async function readPdfAttachment(
  file: File,
  options: ReadAttachmentOptions & { maxBytes: number },
  signal?: AbortSignal,
): Promise<ReadAttachmentResult> {
  if (file.type !== PDF_MIME || !options?.allowLocalFallback) {
    return readFileAsAttachment(file, signal, options);
  }
  if (file.size > options.maxBytes) {
    return {
      ok: false,
      error: `文件过大（上限 ${Math.round(options.maxBytes / 1024 / 1024)}MB）`,
    };
  }
  signal?.throwIfAborted();
  const readLocalPdf = () => createLocalAttachment(file, URL.createObjectURL(file));
  try {
    const config = await fileUploadConfig();
    signal?.throwIfAborted();
    if (!config.enabled) return { ok: true, attachment: readLocalPdf() };

    const fileId = await uploadPlaygroundFile(file, config.project_id ?? '', signal);
    signal?.throwIfAborted();
    return {
      ok: true,
      attachment: createLocalAttachment(file, URL.createObjectURL(file), { fileId }),
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return { ok: true, attachment: readLocalPdf() };
  }
}
