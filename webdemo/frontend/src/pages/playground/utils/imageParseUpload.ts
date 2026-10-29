import { fileUploadConfig, uploadPlaygroundFile } from '@/api/map/fileUploads';
import {
  createLocalAttachment,
  readPreviewAttachment,
  type ReadAttachmentOptions,
  type ReadAttachmentResult,
} from './attachments';

/**
 * OCR 原件只上传文件服务，PDF 使用 Blob URL 预览，不经过旧资产或本地兜底。
 * @param file 已完成格式和大小校验的文件
 * @param options 文档格式及大小边界
 * @param signal 上传生命周期
 * @returns 稳定 fileId 与本地预览；失败不返回可识别附件
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
