import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { readPdfPreviewFrame, rememberPdfPreviewFrame } from './pdfPreviewFrameCache';

/** Map a PDF.js error to stable copy, and do not expose the parser's internal stack on the page. */
export function pdfError(error: unknown): string {
  if (error instanceof Error && error.name === 'PasswordException') return 'documentPdfPassword';
  return 'documentPdfFailed';
}

/** Base size of a PDF page; rotation stores only the orientation that comes with the file. */
export interface PdfPageGeometry {
  pageNumber: number;
  width: number;
  height: number;
  rotation: number;
}

/** Page placeholder size before user zoom is applied; the actual display size is computed from a CSS variable. */
export interface PdfPageView extends Pick<PdfPageGeometry, 'pageNumber' | 'rotation'> {
  baseWidth: number;
  baseHeight: number;
}

/** Batch size for measuring large-PDF page sizes in the background, so the PDF.js worker and the main thread are not occupied all at once. */
const PDF_GEOMETRY_BATCH_SIZE = 8;

interface PdfProgressiveGeometryOptions {
  document: PDFDocumentProxy;
  anchorPage: number;
  onInitial: (geometries: PdfPageGeometry[]) => void;
  onUpdate: (geometries: PdfPageGeometry[]) => void;
  onError?: (error: unknown) => void;
}

/** Read one page's raw geometry; on failure the caller decides whether to keep the estimate. */
async function measurePdfPageGeometry(
  document: PDFDocumentProxy,
  pageNumber: number,
): Promise<PdfPageGeometry> {
  const pdfPage = await document.getPage(pageNumber);
  const view = pdfPage.getViewport({ scale: 1, rotation: 0 });
  return { pageNumber, width: view.width, height: view.height, rotation: pdfPage.rotate };
}

/** Expand the measurement order outward from the anchor page, so neighboring pages the user is about to scroll to are corrected first. */
function createPdfGeometryOrder(anchorPage: number, pageCount: number): number[] {
  const order: number[] = [];
  for (let distance = 1; distance < pageCount; distance += 1) {
    const after = anchorPage + distance;
    const before = anchorPage - distance;
    if (after <= pageCount) order.push(after);
    if (before >= 1) order.push(before);
  }
  return order;
}

/** Return a new array only when page geometry actually changed; pages of the same size do not trigger a re-render. */
function mergePdfPageGeometries(
  current: PdfPageGeometry[],
  updates: readonly PdfPageGeometry[],
): PdfPageGeometry[] {
  const next = [...current];
  let changed = false;
  updates.forEach((update) => {
    const index = update.pageNumber - 1;
    const existing = next[index];
    if (
      !existing ||
      existing.width !== update.width ||
      existing.height !== update.height ||
      existing.rotation !== update.rotation
    ) {
      next[index] = update;
      changed = true;
    }
  });
  return changed ? next : current;
}

/** Build a geometry signature of the visible pages, so an offscreen page-size correction does not redraw the current page. */
export function createVisiblePdfGeometryKey(
  geometryByPage: ReadonlyMap<number, PdfPageGeometry>,
  pageNumbers: readonly number[],
): string {
  return pageNumbers
    .map((pageNumber) => {
      const geometry = geometryByPage.get(pageNumber);
      return geometry
        ? `${pageNumber}:${geometry.width}:${geometry.height}:${geometry.rotation}`
        : `${pageNumber}:missing`;
    })
    .join('|');
}

/**
 * Publish a full PDF skeleton from the anchor page first, then correct the geometry of the remaining pages in batches.
 *
 * Then, when switching history records, the current page can render immediately, and a large document does not have to wait for every `getPage`
 * call to finish before the page structure appears.
 */
export function measurePdfPageGeometries({
  document,
  anchorPage,
  onInitial,
  onUpdate,
  onError,
}: PdfProgressiveGeometryOptions): { cancel: () => void } {
  let cancelled = false;
  let timer: number | undefined;
  let timerIsIdle = false;
  const yieldToBrowser = () =>
    new Promise<void>((resolve) => {
      if (typeof window.requestIdleCallback === 'function') {
        timerIsIdle = true;
        timer = window.requestIdleCallback(() => resolve(), { timeout: 500 });
        return;
      }
      timer = window.setTimeout(resolve, 0);
    });
  const run = async () => {
    const pageCount = document.numPages;
    const anchor = Math.min(Math.max(1, anchorPage), pageCount);
    const anchorGeometry = await measurePdfPageGeometry(document, anchor);
    if (cancelled) return;
    const initial = Array.from({ length: pageCount }, (_, index) => ({
      ...anchorGeometry,
      pageNumber: index + 1,
    }));
    let geometries = initial;
    onInitial(geometries);
    const order = createPdfGeometryOrder(anchor, pageCount);
    await yieldToBrowser();
    for (let start = 0; start < order.length; start += PDF_GEOMETRY_BATCH_SIZE) {
      if (cancelled) return;
      const batch = order.slice(start, start + PDF_GEOMETRY_BATCH_SIZE);
      const updates = await Promise.all(
        batch.map((pageNumber) => measurePdfPageGeometry(document, pageNumber)),
      );
      if (cancelled) return;
      const next = mergePdfPageGeometries(geometries, updates);
      if (next !== geometries) {
        geometries = next;
        onUpdate(geometries);
      }
      if (start + PDF_GEOMETRY_BATCH_SIZE < order.length) await yieldToBrowser();
    }
  };
  void run().catch((error: unknown) => {
    if (!cancelled) onError?.(error);
  });
  return {
    cancel: () => {
      cancelled = true;
      if (timer === undefined) return;
      if (timerIsIdle) window.cancelIdleCallback(timer);
      else window.clearTimeout(timer);
    },
  };
}

/** One frame PDF.js finished drawing in the background but has not yet committed to the DOM canvas. */
export interface PdfPageFrame {
  buffer: HTMLCanvasElement;
  width: number;
  height: number;
}

/** Render parameters for one page; width is the usable content width of the PDF viewport. */
export interface PdfPageRenderOptions {
  geometry: PdfPageGeometry;
  availableWidth: number;
  scale: number;
  rotation: number;
  /** A fixed example enables a bounded pixel cache; an explicit retry changes the version, and ordinary history does not keep frames. */
  cacheKey?: string;
}

/**
 * Create a background render task for one PDF page.
 *
 * The task finishes PDF.js drawing on an offscreen canvas first, then returns the display size; the caller can atomically commit the returned frame
 * to the DOM canvas, so a blank page does not appear during zoom or rotation.
 */
export function createPdfPageRenderTask(
  document: PDFDocumentProxy,
  pageNumber: number,
  options: PdfPageRenderOptions,
  buffer: HTMLCanvasElement,
): { promise: Promise<PdfPageFrame>; cancel: () => void } {
  const { geometry, availableWidth, scale, rotation, cacheKey } = options;
  const key =
    cacheKey === undefined
      ? undefined
      : `${cacheKey}:${pageNumber}:${availableWidth}:${scale}:${rotation}:${window.devicePixelRatio || 1}:${geometry.width}:${geometry.height}:${geometry.rotation}`;
  let task: RenderTask | undefined;
  let cancelled = false;
  const promise = (async (): Promise<PdfPageFrame> => {
    if (key !== undefined) {
      const cached = readPdfPreviewFrame(document, key, buffer);
      if (cached) return cached;
    }
    const pdfPage = await document.getPage(pageNumber);
    if (cancelled) throw new DOMException('Render cancelled', 'AbortError');
    const pageRotation = (geometry.rotation + rotation) % 360;
    const original = pdfPage.getViewport({ scale: 1, rotation: pageRotation });
    const fit = Math.min(Math.max(availableWidth, 0) / original.width, 1.5);
    const view = pdfPage.getViewport({
      scale: Math.max(0.1, fit) * scale,
      rotation: pageRotation,
    });
    const resolution = Math.min(
      window.devicePixelRatio || 1,
      2,
      Math.sqrt(4_000_000 / (view.width * view.height)),
    );
    const pixelView = pdfPage.getViewport({
      scale: view.scale * resolution,
      rotation: pageRotation,
    });
    buffer.width = Math.floor(pixelView.width);
    buffer.height = Math.floor(pixelView.height);
    task = pdfPage.render({ canvas: buffer, viewport: pixelView });
    try {
      await task.promise;
      const frame = { buffer, width: view.width, height: view.height };
      if (!cancelled && key !== undefined) rememberPdfPreviewFrame(document, key, frame);
      return frame;
    } finally {
      pdfPage.cleanup();
    }
  })();
  return {
    promise,
    cancel: () => {
      cancelled = true;
      task?.cancel();
    },
  };
}

/**
 * Find the page whose center is closest to the viewport center, among the current page and its left and right neighbors.
 *
 * Comparing only neighbors keeps scroll page-number updates O(1), and avoids the previous and next pages oscillating because of the gap between pages.
 */
export function getNearestPdfPage(
  current: number,
  pageCount: number,
  viewportCenter: number,
  pageNodes: ReadonlyMap<number, HTMLElement>,
): number {
  const distanceTo = (pageNumber: number) => {
    const node = pageNodes.get(pageNumber);
    return node
      ? Math.abs(node.offsetTop + node.offsetHeight / 2 - viewportCenter)
      : Number.POSITIVE_INFINITY;
  };
  let nearest = current;
  let distance = distanceTo(current);
  for (const candidate of [current - 1, current + 1]) {
    if (candidate < 1 || candidate > pageCount) continue;
    const candidateDistance = distanceTo(candidate);
    if (candidateDistance < distance) {
      nearest = candidate;
      distance = candidateDistance;
    }
  }
  return nearest;
}
