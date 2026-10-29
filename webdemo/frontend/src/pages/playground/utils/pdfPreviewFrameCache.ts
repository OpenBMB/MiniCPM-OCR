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
 * Copy a hit page frame onto this offscreen canvas; the caller still updates the visible canvas through an atomic commit.
 * @param document current PDF.js document
 * @param key page, zoom, rotation, resolution, and retry version
 * @param buffer buffer dedicated to this commit
 * @returns the hit page frame, or undefined on a miss
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
 * Keep finished pixel copies of a fixed example; evict by LRU, at most eight frames and no more than 48 MB of pixel memory.
 * @param document current PDF.js document
 * @param key page-view identity
 * @param frame frame PDF.js drew successfully
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

/** When a PDF.js document is destroyed, release all of its cached pixels and references at the same time. */
export function clearPdfPreviewFrames(document: PDFDocumentProxy) {
  for (const entry of frames) {
    if (entry.document === document) discard(entry);
  }
}
