/**
 * Multimodal attachment helpers: read a file for preview, upload to object storage, check type and size, and map OpenAI content parts.
 *
 * Purpose: Playground uploads of images, video, and files prefer an object-storage URL so base64 does not bloat the L2 request body;
 * audio still uses raw base64 because of the OpenAI input_audio contract.
 */

import { mapAssetsApi } from '@/api/map/assets';
import { fileUploadConfig, uploadPlaygroundFile } from '@/api/map/fileUploads';
import type { Attachment, AttachmentKind } from '../types';
import type { ChatContentPart } from '@/api/map/chat';

/** Validation config for each modality: allowed MIME types, size limit, and Chinese label */
interface KindConfig {
  /** Exact allowed MIME list (the file modality has no allowlist; it only falls back by size and "not media") */
  accept: string[];
  /** Size limit (bytes) */
  maxBytes: number;
  /** Chinese label (used in error copy) */
  label: string;
}

const MB = 1024 * 1024;

/** Per-attachment size limit for images, audio, and video. */
const MAX_BYTES_PER_ATTACHMENT = 8 * MB;
/** Document upload size limit; must stay consistent with backend ASSET_UPLOAD_MAX_BYTES and the portal Nginx limit. */
const MAX_BYTES_PER_DOCUMENT = 200 * MB;

/** Modality config table */
const KIND_CONFIG: Record<AttachmentKind, KindConfig> = {
  image: {
    accept: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    maxBytes: MAX_BYTES_PER_ATTACHMENT,
    label: '图片',
  },
  video: {
    accept: ['video/mp4', 'video/webm', 'video/quicktime'],
    maxBytes: MAX_BYTES_PER_ATTACHMENT,
    label: '视频',
  },
  audio: {
    accept: [
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/x-wav',
      'audio/webm',
      'audio/ogg',
      'audio/mp4',
    ],
    maxBytes: MAX_BYTES_PER_ATTACHMENT,
    label: '音频',
  },
  file: {
    // Common document and text types; anything that is not image/video/audio actually falls back to file
    accept: [
      'application/pdf',
      'text/plain',
      'text/markdown',
      'text/csv',
      'application/json',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    maxBytes: MAX_BYTES_PER_DOCUMENT,
    label: '文件',
  },
};

function mimeAllowed(mime: string, allowed: readonly string[]): boolean {
  const normalized = mime.toLowerCase();
  return allowed.some((item) => {
    const candidate = item.toLowerCase();
    return candidate.endsWith('/*')
      ? normalized.startsWith(candidate.slice(0, -1))
      : normalized === candidate;
  });
}

/**
 * File-picker accept value for a single attachment modality.
 * @param kind attachment modality
 * @returns MIME types and extensions
 */
export function getAttachmentAccept(kind: AttachmentKind): string[] {
  const cfg = KIND_CONFIG[kind];
  if (kind !== 'file') return cfg.accept;
  return [...cfg.accept, '.pdf', '.txt', '.md', '.csv', '.json', '.doc', '.docx'];
}

/** Cap on attachments per message (keeps the request body from growing too large) */
export const MAX_ATTACHMENTS = 6;

/**
 * Classify an attachment modality by MIME. image/video/audio prefixes each map to their own kind; everything else is file.
 * @param mime file MIME
 */
export function detectKind(mime: string): AttachmentKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

/** Build a local attachment object; the preview URL may be either a data URL or a runtime Blob URL. */
export function createLocalAttachment(
  file: File,
  previewUrl: string,
  extra?: Pick<Attachment, 'fileId' | 'url' | 'proxyUrl' | 'publicUrl' | 'objectKey'>,
): Attachment {
  return {
    id: nextId(),
    kind: detectKind(file.type),
    name: file.name,
    mime: file.type,
    size: file.size,
    dataUrl: previewUrl,
    ...extra,
  };
}

/** Read result: success carries an attachment, failure carries a Chinese error message */
export interface ReadAttachmentResult {
  ok: boolean;
  attachment?: Attachment;
  error?: string;
}

/** Callers may override read behavior; omitting options keeps the Playground attachment rules. */
export interface ReadAttachmentOptions {
  /** Per-file size limit. */
  maxBytes?: number;
  /** Caller-specific MIME allowlist; defaults to the current modality config. */
  accept?: readonly string[];
  /** OCR only: when the file service is unavailable, allow falling back to a local dataUrl so recognition is not blocked. */
  allowLocalFallback?: boolean;
  /** OCR only: use the legacy asset upload entry directly and return the platform signed URL. */
  preferLegacyUpload?: boolean;
}

let seq = 0;
/** Generate a unique attachment id (frontend key / removal; does not need cryptographic strength) */
function nextId(): string {
  seq += 1;
  return `att_${Date.now().toString(36)}_${seq.toString(36)}`;
}

/**
 * Read a single file as a local preview data URL, with no network request.
 * @param file file the user selected
 * @param signal abort signal for an older file read when images are selected in succession
 * @returns success includes an attachment; failure includes a Chinese error
 */
export async function readPreviewAttachment(
  file: File,
  signal?: AbortSignal,
  options?: ReadAttachmentOptions,
): Promise<ReadAttachmentResult> {
  const kind = detectKind(file.type);
  const cfg = KIND_CONFIG[kind];
  const maxBytes = options?.maxBytes ?? cfg.maxBytes;
  // Media kinds are checked against a MIME allowlist; the file fallback kind does not limit the specific type (only the size cap)
  const allowedTypes = options?.accept ?? cfg.accept;
  if (kind !== 'file' && !mimeAllowed(file.type, allowedTypes)) {
    return Promise.resolve({
      ok: false,
      error: `不支持的${cfg.label}格式：${file.type || '未知'}`,
    });
  }
  if (file.size > maxBytes) {
    return Promise.resolve({
      ok: false,
      error: `${cfg.label}过大（上限 ${Math.round(maxBytes / MB)}MB）`,
    });
  }
  signal?.throwIfAborted();
  return new Promise<ReadAttachmentResult>((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const abort = () => {
      cleanup();
      reader.abort();
      reject(new DOMException('Attachment upload aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    reader.onload = () => {
      cleanup();
      resolve({
        ok: true,
        attachment: {
          id: nextId(),
          kind,
          name: file.name,
          mime: file.type,
          size: file.size,
          dataUrl: String(reader.result),
        },
      });
    };
    reader.onerror = () => {
      cleanup();
      resolve({ ok: false, error: `${cfg.label}读取失败` });
    };
    reader.readAsDataURL(file);
  });
}

function isUploadError(
  error: unknown,
): error is { code: string; details?: { obs_code?: unknown } } {
  return Boolean(
    error &&
      typeof error === 'object' &&
      typeof (error as { code?: unknown }).code === 'string',
  );
}

/** Fall back to the legacy entry only for a service or storage failure; business validation, auth, and rate-limit errors must not be bypassed. */
function canFallbackToLegacyUpload(error: unknown): boolean {
  if (!isUploadError(error)) return false;
  if (
    error.code === 'UNAVAILABLE' ||
    error.code === 'NETWORK' ||
    error.code === 'INTERNAL' ||
    error.code === 'ETAG_UNREADABLE' ||
    error.code === 'STORAGE_REJECTED' ||
    error.code === 'INVALID_RESPONSE'
  ) {
    return true;
  }
  return error.code === 'PERMISSION_DENIED' && typeof error.details?.obs_code === 'string';
}

/**
 * Read the attachment and write it to the file service first; a general attachment falls back to the legacy asset entry when the file service fails.
 * When OCR chooses the local fallback, do not touch the legacy entry, so an object that will not be used is not uploaded.
 * @param file file the user selected
 * @param signalOrIndex abort signal; compatible with old callers that passed an index
 * @param options size cap and local-fallback policy
 */
export async function readFileAsAttachment(
  file: File,
  signalOrIndex?: AbortSignal | number,
  options?: ReadAttachmentOptions,
): Promise<ReadAttachmentResult> {
  const signal = typeof signalOrIndex === 'number' ? undefined : signalOrIndex;
  const cfg = KIND_CONFIG[detectKind(file.type)];
  const local = await readPreviewAttachment(file, signal, options);
  if (!local.ok || !local.attachment) return local;
  const localAttachment = local.attachment;
  if (signal?.aborted) {
    throw new DOMException('Attachment upload aborted', 'AbortError');
  }

  const uploadLegacy = async (): Promise<ReadAttachmentResult> => {
    const uploaded = await mapAssetsApi.upload(file, signal);
    return {
      ok: true,
      attachment: {
        ...localAttachment,
        url: uploaded.public_url || uploaded.obs_url || uploaded.url,
        proxyUrl: uploaded.proxy_url || uploaded.url,
        publicUrl: uploaded.public_url,
        objectKey: uploaded.key,
      },
    };
  };
  const failed = (failure: unknown): ReadAttachmentResult => {
    const message = failure instanceof Error ? failure.message : `${cfg.label}上传失败`;
    return { ok: false, error: message || `${cfg.label}上传失败` };
  };
  const rethrowAbort = (failure: unknown) => {
    if (failure instanceof DOMException && failure.name === 'AbortError') throw failure;
  };

  if (options?.preferLegacyUpload) {
    try {
      return await uploadLegacy();
    } catch (failure) {
      rethrowAbort(failure);
      if (options.allowLocalFallback) return local;
      return failed(failure);
    }
  }

  let config: Awaited<ReturnType<typeof fileUploadConfig>>;
  try {
    config = await fileUploadConfig();
    signal?.throwIfAborted();
  } catch (failure) {
    rethrowAbort(failure);
    if (options?.allowLocalFallback) return local;
    try {
      return await uploadLegacy();
    } catch (legacyFailure) {
      rethrowAbort(legacyFailure);
      return failed(legacyFailure);
    }
  }

  if (config.enabled) {
    if (!config.project_id) return failed(new Error('上传项目无效'));
    try {
      const fileId = await uploadPlaygroundFile(file, config.project_id, signal);
      return { ok: true, attachment: { ...localAttachment, fileId } };
    } catch (failure) {
      rethrowAbort(failure);
      if (options?.allowLocalFallback) return local;
      if (!canFallbackToLegacyUpload(failure)) return failed(failure);
    }
  } else if (options?.allowLocalFallback) {
    return local;
  }

  try {
    return await uploadLegacy();
  } catch (failure) {
    rethrowAbort(failure);
    return failed(failure);
  }
}

/** Take the raw base64 out of a data URL, without the prefix (input_audio.data needs the raw string) */
function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/** Infer the OpenAI input_audio format field (mp3/wav/...) from the audio MIME */
function audioFormat(mime: string): string {
  if (mime === 'audio/mpeg' || mime === 'audio/mp3') return 'mp3';
  if (mime === 'audio/wav' || mime === 'audio/x-wav') return 'wav';
  const sub = mime.split('/')[1];
  return sub || 'mp3';
}

/**
 * Map an attachment to an OpenAI-compatible content part.
 * - image → image_url; video → video_url (the Qwen-VL convention and similar), preferring the platform's public signed proxy URL
 * - audio → input_audio (raw base64 + format); file → file (file_url first, file_data as fallback)
 * @param att attachment
 */
export function attachmentToPart(att: Attachment): ChatContentPart {
  const url = att.publicUrl || att.url || att.dataUrl;
  switch (att.kind) {
    case 'image':
      return { type: 'image_url', image_url: { url } };
    case 'video':
      return { type: 'video_url', video_url: { url } };
    case 'audio':
      return {
        type: 'input_audio',
        input_audio: { data: stripDataUrlPrefix(att.dataUrl), format: audioFormat(att.mime) },
      };
    case 'file':
      return att.publicUrl || att.url
        ? { type: 'file', file: { filename: att.name, file_url: att.publicUrl || att.url } }
        : { type: 'file', file: { filename: att.name, file_data: att.dataUrl } };
  }
}

/** accept value for input[type=file]: every modality allowlist plus common document extensions */
export const ATTACHMENT_ACCEPT = (Object.keys(KIND_CONFIG) as AttachmentKind[])
  .flatMap((kind) => getAttachmentAccept(kind))
  .join(',');

/** Human-readable file size (for attachment display) */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}
