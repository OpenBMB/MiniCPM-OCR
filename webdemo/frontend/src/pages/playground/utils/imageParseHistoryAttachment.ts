import type { Attachment } from '../types';
import { isDocumentImageMime } from './documentUpload';
import { IMAGE_PARSE_SAMPLE_ATTACHMENT_ID } from './imageParseSample';
import { IMAGE_PARSE_SHARED_EXAMPLES } from './imageParseExamples';

const LOCAL_IMAGE = /^data:image\/(?!svg(?:\+xml)?;)[a-z0-9.+-]+;base64,[a-z\d+/=\s]+$/i;
const LOCAL_PDF = /^data:application\/pdf;base64,[a-z\d+/=\s]+$/i;
const FILE_UPLOAD_ID = /^[a-zA-Z0-9_-]{3,80}$/;

/** 快照清洗模式：本地缓存、云端保存与运行时恢复各有不同原件边界。 */
export interface SanitizeImageParseSnapshotOptions {
  storage?: 'local' | 'cloud';
  /** 仅运行时恢复允许 fileId 位图/PDF 签链及固定共享 PDF；保存入口不得开启。 */
  allowHydratedFileURL?: boolean;
  /** 仅共享图片案例运行时恢复允许空结果，不用于历史保存。 */
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

/** 按存储和运行时边界清洗历史附件，签链仅用于预览，永不进入持久化存档。 */
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
  // 不使用 spread：附件可能携带对象存储标识或运行时注入的凭据。
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
