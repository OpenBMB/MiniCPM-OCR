import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PdfPageFrame } from './pdfPreviewRender';

const MAX_PIXELS = 12_000_000;
const MAX_FRAMES = 8;

interface CachedFrame {
  document: PDFDocumentProxy;
  key: string;
  frame: PdfPageFrame;
  pixels: number;
}

const frames = new Set<CachedFrame>();
let pixels = 0;

function discard(entry: CachedFrame) {
  frames.delete(entry);
  pixels -= entry.pixels;
  entry.frame.buffer.width = entry.frame.buffer.height = 0;
}

/**
 * 将命中的页面帧复制到本次离屏画布；调用方仍通过原子提交更新可见 canvas。
 * @param document 当前 PDF.js 文档
 * @param key 页面、缩放、旋转、分辨率与重试版本
 * @param buffer 本次提交专用缓冲区
 * @returns 命中的页面帧，未命中返回 undefined
 */
export function readPdfPreviewFrame(
  document: PDFDocumentProxy,
  key: string,
  buffer: HTMLCanvasElement,
): PdfPageFrame | undefined {
  for (const entry of frames) {
    if (entry.document !== document || entry.key !== key) continue;
    const context = buffer.getContext('2d');
    if (!context) return undefined;
    frames.delete(entry);
    frames.add(entry);
    buffer.width = entry.frame.buffer.width;
    buffer.height = entry.frame.buffer.height;
    context.drawImage(entry.frame.buffer, 0, 0);
    return { ...entry.frame, buffer };
  }
  return undefined;
}

/**
 * 保留固定案例的已完成像素副本；按 LRU 淘汰，最多八帧且像素内存不超过 48 MB。
 * @param document 当前 PDF.js 文档
 * @param key 页面视图身份
 * @param frame PDF.js 成功绘制的帧
 */
export function rememberPdfPreviewFrame(
  document: PDFDocumentProxy,
  key: string,
  frame: PdfPageFrame,
) {
  const count = frame.buffer.width * frame.buffer.height;
  if (!count || count > MAX_PIXELS) return;
  const buffer = frame.buffer.ownerDocument.createElement('canvas');
  const context = buffer.getContext('2d');
  if (!context) return;
  for (const entry of frames) {
    if (entry.document === document && entry.key === key) discard(entry);
  }
  while (frames.size >= MAX_FRAMES || pixels + count > MAX_PIXELS) {
    const oldest = frames.values().next().value;
    if (!oldest) break;
    discard(oldest);
  }
  buffer.width = frame.buffer.width;
  buffer.height = frame.buffer.height;
  context.drawImage(frame.buffer, 0, 0);
  frames.add({ document, key, frame: { ...frame, buffer }, pixels: count });
  pixels += count;
}

/** PDF.js 文档销毁时同步释放其全部缓存像素与引用。 */
export function clearPdfPreviewFrames(document: PDFDocumentProxy) {
  for (const entry of frames) {
    if (entry.document === document) discard(entry);
  }
}
