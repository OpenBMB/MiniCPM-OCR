import { fileUploadConfig, uploadPlaygroundFile } from '@/api/map/fileUploads';
import {
  createLocalAttachment,
  readFileAsAttachment,
  type ReadAttachmentOptions,
  type ReadAttachmentResult,
} from './attachments';

const PDF_MIME = 'application/pdf';

/**
 * 读取 OCR PDF：文件服务可用时先上传原件，再用运行时 Blob URL 预览。
 *
 * 大 PDF 不能先转 base64 data URL；否则 FileReader 与 PDF.js 解码都会长时间占用主线程。
 * Blob URL 仅保存在当前附件状态，云端历史仍只持久化稳定 fileId。
 * @param file 用户选择的 PDF
 * @param signal 连续替换文件时的取消信号
 * @param options OCR 的大小上限与本地兜底策略
 * @returns 上传成功返回 fileId + Blob URL；本地兜底也使用 Blob URL，避免 base64 阻塞主线程
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
