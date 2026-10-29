import type { Attachment } from '../types';
import { isDocumentImageMime } from './documentUpload';
import { IMAGE_PARSE_SAMPLE_ATTACHMENT_ID } from './imageParseSample';
import { IMAGE_PARSE_SHARED_EXAMPLES } from './imageParseExamples';

const LOCAL_IMAGE = /^data:image\/(?!svg(?:\+xml)?;)[a-z0-9.+-]+;base64,[a-z\d+/=\s]+$/i;
const LOCAL_PDF = /^data:application\/pdf;base64,[a-z\d+/=\s]+$/i;
const FILE_UPLOAD_ID = /^[a-zA-Z0-9_-]{3,80}$/;

/** Snapshot cleaning mode: local cache, cloud save, and runtime restore each have a different original-file boundary. */
export interface SanitizeImageParseSnapshotOptions {
  storage?: 'local' | 'cloud';
  /** Only runtime restore may use a fileId bitmap/PDF signed URL and the fixed shared PDF; save entries must not enable it. */
  allowHydratedFileURL?: boolean;
  /** Only runtime restore of a shared image example may have an empty result; it is not used when saving history. */
  allowSharedImagePreview?: boolean;
}

function attachmentKind(value: Record<string, unknown>): Attachment['kind'] | null {
  if (value.kind === 'image') return 'image';
  if (value.kind === 'file') return 'file';
  return null;
}

function isFileURL(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Clean history attachments against storage and runtime boundaries. Signed URLs are for preview only and never enter the persisted archive. */
export function sanitizeImageParseHistoryAttachment(
  value: unknown,
  options: SanitizeImageParseSnapshotOptions,
): Attachment | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    typeof input.id !== 'string' ||
    !input.id ||
    input.id === IMAGE_PARSE_SAMPLE_ATTACHMENT_ID ||
    typeof input.name !== 'string' ||
    typeof input.mime !== 'string' ||
    typeof input.size !== 'number' ||
    !Number.isFinite(input.size) ||
    input.size < 0
  )
    return null;
  const kind = attachmentKind(input);
  if (!kind) return null;
  const dataPattern = kind === 'image' ? LOCAL_IMAGE : LOCAL_PDF;
  const fileId =
    typeof input.fileId === 'string' && FILE_UPLOAD_ID.test(input.fileId) ? input.fileId : '';
  const allowRuntimeURL = options.allowHydratedFileURL === true && options.storage === undefined;
  const sharedPDFURL =
    allowRuntimeURL &&
    kind === 'file' &&
    input.mime === 'application/pdf' &&
    IMAGE_PARSE_SHARED_EXAMPLES.some(
      (example) =>
        example.format === 'PDF' && example.id === input.id && example.url === input.dataUrl,
    )
      ? (input.dataUrl as string)
      : '';
  const runtimeMIME =
    (kind === 'file' && input.mime === 'application/pdf') ||
    (kind === 'image' && isDocumentImageMime(input.mime));
  const runtimeURL =
    allowRuntimeURL &&
    fileId !== '' &&
    runtimeMIME &&
    typeof input.dataUrl === 'string' &&
    isFileURL(input.dataUrl)
      ? input.dataUrl
      : '';
  const dataUrl =
    sharedPDFURL ||
    runtimeURL ||
    (typeof input.dataUrl === 'string' && dataPattern.test(input.dataUrl) ? input.dataUrl : '');
  if (options.storage === 'cloud' && fileId) {
    return {
      id: input.id,
      kind,
      name: input.name,
      mime: input.mime,
      size: input.size,
      dataUrl: '',
      fileId,
    };
  }
  if (!dataUrl) return null;
  // Do not use spread: an attachment may carry an object-storage id or a credential injected at runtime.
  return {
    id: input.id,
    kind,
    name: input.name,
    mime: input.mime,
    size: input.size,
    dataUrl,
    ...(fileId ? { fileId } : {}),
  };
}
