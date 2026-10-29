import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

import type { PdfPageFrame } from '../utils/pdfPreviewRender';

/** A committed page stores only the view identity; when an offscreen canvas is removed, clear its pixels and cache immediately. */
export interface RenderedPdfPage {
  key: string;
  canvas: HTMLCanvasElement;
  scale: number;
  rotation: number;
  frame?: PdfPageFrame;
  error?: string;
}

/**
 * Manage the lifetime of the visible canvas and committed frames, without letting a frame commit change render-task dependencies.
 * @param document current PDF document
 * @param revision user retry version
 * @returns canvas registration, the frame cache, state publishing, and the retry entry
 */
export function usePdfPreviewFrames(document: PDFDocumentProxy | undefined, revision: number) {
  const scope = useMemo(() => ({ document, revision }), [document, revision]);
  const [canvases, setCanvases] = useState<Record<number, HTMLCanvasElement>>({});
  const [state, setState] = useState({
    scope,
    pages: {} as Record<number, RenderedPdfPage>,
  });
  const canvasNodes = useRef<Record<number, HTMLCanvasElement>>({});
  const cache = useRef({ scope, pages: {} as Record<number, RenderedPdfPage> });
  const [attempt, setAttempt] = useState(0);
  useLayoutEffect(() => {
    if (cache.current.scope === scope) return;
    Object.values(cache.current.pages).forEach(releaseBuffer);
    cache.current = { scope, pages: {} };
  }, [scope]);
  useLayoutEffect(() => {
    if (state.scope !== scope) return;
    Object.entries(state.pages).forEach(([pageNumber, item]) => {
      const frame = item.frame;
      if (!frame?.buffer.width || canvasNodes.current[Number(pageNumber)] !== item.canvas) return;
      const context = item.canvas.getContext('2d');
      if (!context) return;
      // Pixels, orientation, zoom, and recognition boxes take effect in the same layout commit, and pixels must not be swapped first inside an async callback.
      item.canvas.width = frame.buffer.width;
      item.canvas.height = frame.buffer.height;
      // Each page's high-resolution frame is committed page by page; display size follows only that page's skeleton, and must not share the current page's frame scale.
      item.canvas.style.width = '100%';
      item.canvas.style.height = '100%';
      context.drawImage(frame.buffer, 0, 0);
      releaseBuffer(item);
    });
  }, [scope, state]);
  const getFrame = useCallback((pageNumber: number) => cache.current.pages[pageNumber], []);
  const isCurrentCanvas = useCallback(
    (pageNumber: number, canvas: HTMLCanvasElement) => canvasNodes.current[pageNumber] === canvas,
    [],
  );
  const commitFrame = useCallback(
    (pageNumber: number, frame: RenderedPdfPage) => {
      if (cache.current.scope !== scope) return false;
      const previous = cache.current.pages[pageNumber];
      if (previous && previous.frame !== frame.frame) releaseBuffer(previous);
      cache.current.pages = { ...cache.current.pages, [pageNumber]: frame };
      setState({ scope, pages: cache.current.pages });
      return true;
    },
    [scope],
  );
  const setPageCanvas = useCallback((pageNumber: number, canvas: HTMLCanvasElement | null) => {
    const previous = canvasNodes.current[pageNumber];
    if (previous === canvas || (!previous && !canvas)) return;
    if (previous) previous.width = previous.height = 0;
    const next = { ...canvasNodes.current };
    if (canvas) next[pageNumber] = canvas;
    else delete next[pageNumber];
    canvasNodes.current = next;
    const remaining = { ...cache.current.pages };
    if (remaining[pageNumber]) releaseBuffer(remaining[pageNumber]);
    delete remaining[pageNumber];
    cache.current.pages = remaining;
    setState({ scope: cache.current.scope, pages: remaining });
    setCanvases(next);
  }, []);
  useEffect(() => {
    const nodes = canvasNodes;
    const cached = cache;
    return () => {
      Object.values(nodes.current).forEach((canvas) => {
        canvas.width = canvas.height = 0;
      });
      Object.values(cached.current.pages).forEach(releaseBuffer);
    };
  }, []);
  const reset = useCallback(() => {
    Object.values(cache.current.pages).forEach(releaseBuffer);
    cache.current.pages = {};
    setState({ scope: cache.current.scope, pages: {} });
    setAttempt((value) => value + 1);
  }, []);
  return {
    canvases,
    rendered: state.scope === scope ? state.pages : {},
    getFrame,
    isCurrentCanvas,
    commitFrame,
    attempt,
    setPageCanvas,
    reset,
  };
}

/** Clear buffers that have not been committed or are already offscreen, and do not keep a high-resolution pixel copy. */
function releaseBuffer(item: RenderedPdfPage) {
  if (item.frame) item.frame.buffer.width = item.frame.buffer.height = 0;
}
