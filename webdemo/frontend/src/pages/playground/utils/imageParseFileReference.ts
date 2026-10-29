import { uploadPlaygroundFile } from '@/api/map/fileUploads';

import type { Attachment } from '../types';
import { isDocumentImageDataURL, isPdfAttachment } from './documentUpload';

/** OCR 工作台唯一的原件引用是文件服务 fileId。 */
export interface ImageParseFileReference {
  fileId: string;
}

/** 把 OCR 本地预览还原为可上传文件；仅用于补齐缺失的 OBS 文件引用。 */
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
 * 把运行时附件还原为可上传文件；图片使用本地 data URL，PDF 允许短时预览链接。
 * @param attachment 当前展示的原件
 * @param signal 取消信号
 * @returns 可交给文件服务的 File
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
 * 返回可用于 OCR 的 OBS 文件引用。
 * 新上传通常已有 fileId；旧历史或文件服务临时失败时，从本地预览补传一次。
 * @param options 当前附件、项目与取消信号
 * @returns 文件服务 fileId；无法补传时抛出稳定错误键
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
    // 上传错误可能包含上游签链或内部地址，只向界面暴露稳定文案。
    throw Object.assign(new Error('imageParseFileReferenceUploadFailed'), { cause: error });
  }
}
