/**
 * 把新选的图片或一份 PDF 接在当前文档后面，合成一份新 PDF。
 * 已有 PDF 页按识别时的 2 倍画下来再嵌回去，归一化识别框仍能对上预览。
 */
import type { PDFDocumentProxy } from 'pdfjs-dist';

import type { Attachment } from '../types';
import { DOCUMENT_MAX_BYTES, isPdfAttachment, MAX_PDF_PAGES } from './documentUpload';
import { IMAGE_GROUP_MAX_EDGE, imageFileToJpegPage, pdfFromJpegs } from './imageGroupPdf';

interface JpegPage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

function pdfFailure(cause: unknown): Error {
  return Object.assign(new Error('documentPdfFailed'), { cause });
}

export interface AppendedPdf {
  bytes: Uint8Array;
  previousPages: number;
  totalPages: number;
}

/** 将 PDF 单页按 2 倍缩放编码为 JPEG，保持与逐页识别相同的坐标基准。 */
async function renderPdfPageJpeg(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  signal: AbortSignal,
): Promise<JpegPage> {
  signal.throwIfAborted();
  const page = await pdf.getPage(pageNumber);
  const canvas = document.createElement('canvas');
  try {
    signal.throwIfAborted();
    const viewport = page.getViewport({ scale: 2 });
    const width = Math.max(1, Math.floor(viewport.width));
    const height = Math.max(1, Math.floor(viewport.height));
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('documentPdfFailed');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    const render = page.render({ canvas, canvasContext: context, viewport });
    const abort = () => render.cancel();
    signal.addEventListener('abort', abort, { once: true });
    try {
      await render.promise;
      signal.throwIfAborted();
      const blob = await new Promise<Blob | null>((resolve, reject) => {
        const onAbort = () => reject(new DOMException('Render cancelled', 'AbortError'));
        signal.addEventListener('abort', onAbort, { once: true });
        canvas.toBlob(
          (value) => {
            signal.removeEventListener('abort', onAbort);
            if (signal.aborted) {
              reject(new DOMException('Render cancelled', 'AbortError'));
              return;
            }
            resolve(value);
          },
          'image/jpeg',
          0.92,
        );
      });
      if (!blob) throw new Error('documentPdfFailed');
      return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
    } finally {
      signal.removeEventListener('abort', abort);
    }
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();
  }
}

/** 读取 PDF 全部页面；页数上限与工作台原有预览、识别链路一致。 */
async function pdfSourceToPages(source: string, signal: AbortSignal): Promise<JpegPage[]> {
  signal.throwIfAborted();
  // 按需加载 PDF.js：日常单图上传不需要提前初始化画布依赖。
  const { loadPdfPreview } = await import('./pdfPreview');
  signal.throwIfAborted();
  const task = loadPdfPreview(source);
  try {
    const pdf = await task.promise;
    signal.throwIfAborted();
    if (pdf.numPages > MAX_PDF_PAGES) throw new Error('imageParsePdfTooManyPages');
    const pages: JpegPage[] = [];
    for (let index = 1; index <= pdf.numPages; index += 1) {
      pages.push(await renderPdfPageJpeg(pdf, index, signal));
    }
    return pages;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    if (error instanceof Error && error.name === 'PasswordException') {
      throw pdfFailure(error);
    }
    if (
      error instanceof Error &&
      (error.message === 'imageParsePdfTooManyPages' || error.message === 'documentPdfFailed')
    ) {
      throw error;
    }
    throw pdfFailure(error);
  } finally {
    await task.destroy();
  }
}

/** 将单个新文件转成 JPEG 页；PDF 保持原页序，图片只产生一页。 */
async function fileToPages(
  file: File,
  signal: AbortSignal,
  maxEdge: number,
): Promise<JpegPage[]> {
  if (file.type === 'application/pdf') {
    const url = URL.createObjectURL(file);
    try {
      return await pdfSourceToPages(url, signal);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  signal.throwIfAborted();
  return [await imageFileToJpegPage(file, maxEdge)];
}

/** 读取当前附件；已有图片不缩小，避免识别框与新页图尺寸错位。 */
async function currentToPages(
  current: Pick<Attachment, 'dataUrl' | 'mime' | 'kind' | 'name'>,
  signal: AbortSignal,
): Promise<JpegPage[]> {
  if (isPdfAttachment(current as Attachment)) return pdfSourceToPages(current.dataUrl, signal);
  signal.throwIfAborted();
  const response = await fetch(current.dataUrl, { signal });
  if (!response.ok) throw new Error('documentUploadFailed');
  const blob = await response.blob();
  const file = new File([blob], current.name || 'page', { type: current.mime || blob.type });
  return [await imageFileToJpegPage(file, Number.POSITIVE_INFINITY)];
}

/**
 * 当前文档在前，新选文件按选择顺序接在后面。
 * @param current 当前图片或 PDF 附件
 * @param incoming 通过选择校验的新文件
 * @param signal 取消追加与页面渲染的信号
 * @returns 合成后的 PDF 字节与页数信息
 */
export async function buildAppendedPdf(
  current: Pick<Attachment, 'dataUrl' | 'mime' | 'kind' | 'name'>,
  incoming: readonly File[],
  signal: AbortSignal,
): Promise<AppendedPdf> {
  const previous = await currentToPages(current, signal);
  const added: JpegPage[] = [];
  for (const file of incoming) {
    added.push(...(await fileToPages(file, signal, IMAGE_GROUP_MAX_EDGE)));
  }
  const totalPages = previous.length + added.length;
  if (!previous.length || !added.length) throw new Error('documentEmptyFile');
  if (totalPages > MAX_PDF_PAGES) throw new Error('imageParsePdfTooManyPages');
  const bytes = pdfFromJpegs([...previous, ...added]);
  if (bytes.byteLength > DOCUMENT_MAX_BYTES) throw new Error('documentFileTooLarge');
  return { bytes, previousPages: previous.length, totalPages };
}

/**
 * 把合成后的 PDF 转成 data URL；复制为独立 ArrayBuffer，避免视图类型影响 Blob。
 * @param bytes PDF 文件字节
 * @param mime 输出 MIME，默认 application/pdf
 * @returns 可直接交给附件状态的 data URL
 */
export function bytesToDataUrl(bytes: Uint8Array, mime = 'application/pdf'): Promise<string> {
  return new Promise((resolve, reject) => {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    const blob = new Blob([buffer], { type: mime });
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('documentUploadFailed'));
    reader.readAsDataURL(blob);
  });
}
