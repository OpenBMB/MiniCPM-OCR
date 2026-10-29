/**
 * Append newly selected images or one PDF after the current document and compose a new PDF.
 * Existing PDF pages are drawn at the same 2x used for recognition and embedded again, so normalized recognition boxes still line up with the preview.
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

/** Encode one PDF page as JPEG at 2x scale, keeping the same coordinate basis as per-page recognition. */
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

/** Read every page of a PDF; the page limit matches the workspace preview and recognition path. */
async function pdfSourceToPages(source: string, signal: AbortSignal): Promise<JpegPage[]> {
  signal.throwIfAborted();
  // Load PDF.js on demand: an ordinary single-image upload should not initialize the canvas dependency up front.
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

/** Turn one new file into JPEG pages; a PDF keeps its original page order, and an image produces one page. */
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

/** Read the current attachment; an existing image is not downscaled, so recognition boxes stay aligned with the new page image. */
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
 * The current document comes first; newly selected files are appended in selection order.
 * @param current current image or PDF attachment
 * @param incoming new files that passed selection checks
 * @param signal signal that cancels append and page rendering
 * @returns composed PDF bytes and page-count info
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
 * Turn the composed PDF into a data URL; copy it into an independent ArrayBuffer so the view's typed array does not affect the Blob.
 * @param bytes PDF file bytes
 * @param mime output MIME, default application/pdf
 * @returns a data URL that can be handed straight to attachment state
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
