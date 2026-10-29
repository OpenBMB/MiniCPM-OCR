/** PDF.js reads a local file: the original-text preview and per-page image conversion share the load config. */
import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { trimEmptyPdfRevision } from './pdfPreviewSource';
import { isImageParseSharedPdfUrl } from './imageParseExamples';
import { clearPdfPreviewFrames } from './pdfPreviewFrameCache';

// A published worker was cached as octet-stream for a year; use a new URL so the old response headers are not hit again.
GlobalWorkerOptions.workerSrc = `${workerUrl}${workerUrl.includes('?') ? '&' : '?'}mime=js`;

/** Short-cache duration and capacity for PDF documents that history switching uses often, so the same original is not parsed again and again. */
const PDF_PREVIEW_CACHE_TTL_MS = 30_000;
const PDF_PREVIEW_CACHE_MAX = 2;
const SHARED_PDF_CACHE_TTL_MS = 300_000;
const SHARED_PDF_CACHE_MAX = 4;

interface PdfPreviewCacheEntry {
  task: PDFDocumentLoadingTask;
  refs: number;
  releaseTimer?: number;
}

const pdfPreviewCache = new Map<string, PdfPreviewCacheEntry>();

/** Actually destroy the underlying PDF.js task; swallow non-critical cleanup errors such as destroying twice. */
function destroyPdfPreviewEntry(source: string, entry: PdfPreviewCacheEntry) {
  if (entry.releaseTimer !== undefined) window.clearTimeout(entry.releaseTimer);
  entry.releaseTimer = undefined;
  if (pdfPreviewCache.get(source) === entry) pdfPreviewCache.delete(source);
  void entry.task.promise.then(clearPdfPreviewFrames).catch(() => undefined);
  void entry.task.destroy().catch(() => undefined);
}

/** Release one reference; after the last reference leaves, delay destruction, leaving a reuse window for history switching. */
function releasePdfPreviewEntry(source: string, entry: PdfPreviewCacheEntry) {
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs > 0 || entry.releaseTimer !== undefined) return;
  entry.releaseTimer = window.setTimeout(
    () => {
      entry.releaseTimer = undefined;
      if (entry.refs === 0) destroyPdfPreviewEntry(source, entry);
    },
    isImageParseSharedPdfUrl(source) ? SHARED_PDF_CACHE_TTL_MS : PDF_PREVIEW_CACHE_TTL_MS,
  );
}

/** When capacity is full, evict unreferenced documents first, so too many large PDFs do not stay resident. */
function evictIdlePdfPreviewEntry(shared: boolean) {
  for (const [source, entry] of pdfPreviewCache) {
    if (entry.refs === 0 && isImageParseSharedPdfUrl(source) === shared) {
      destroyPdfPreviewEntry(source, entry);
      return;
    }
  }
}

/** Read or create a PDF.js task; a failed task is not left in the cache. */
function acquirePdfPreviewTask(source: string) {
  const cached = pdfPreviewCache.get(source);
  if (cached) {
    if (cached.releaseTimer !== undefined) {
      window.clearTimeout(cached.releaseTimer);
      cached.releaseTimer = undefined;
    }
    cached.refs += 1;
    pdfPreviewCache.delete(source);
    pdfPreviewCache.set(source, cached);
    return cached;
  }

  const shared = isImageParseSharedPdfUrl(source);
  const count = [...pdfPreviewCache.keys()].filter(
    (key) => isImageParseSharedPdfUrl(key) === shared,
  ).length;
  if (count >= (shared ? SHARED_PDF_CACHE_MAX : PDF_PREVIEW_CACHE_MAX))
    evictIdlePdfPreviewEntry(shared);
  const data = source.startsWith('data:')
    ? trimEmptyPdfRevision(
        Uint8Array.from(atob(source.slice(source.indexOf(',') + 1)), (char) => char.charCodeAt(0)),
      )
    : undefined;
  const task = getDocument({
    ...(data ? { data } : { url: source }),
    cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
    wasmUrl: `${import.meta.env.BASE_URL}pdfjs/wasm/`,
    isEvalSupported: false,
  });
  const entry: PdfPreviewCacheEntry = { task, refs: 1 };
  pdfPreviewCache.set(source, entry);
  // A parse failure must not let a later history switch keep receiving the same failed Promise.
  void task.promise.catch(() => {
    if (pdfPreviewCache.get(source) === entry) pdfPreviewCache.delete(source);
    if (entry.refs === 0) destroyPdfPreviewEntry(source, entry);
  });
  return entry;
}

/**
 * Create a destroyable PDF read task, with auxiliary resources fixed to same-origin static files.
 *
 * The same address reuses the underlying document for a short time, to speed switching back and forth in the left history list; the caller's
 * destroy only releases a reference, and PDF.js resources are cleaned up after a delay once the last reference is released.
 */
export function loadPdfPreview(source: string) {
  const entry = acquirePdfPreviewTask(source);
  let released = false;
  return {
    promise: entry.task.promise,
    destroy: () => {
      if (released) return Promise.resolve();
      released = true;
      releasePdfPreviewEntry(source, entry);
      return Promise.resolve();
    },
  };
}
