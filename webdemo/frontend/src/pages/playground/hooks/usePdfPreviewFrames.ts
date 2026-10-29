import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

import type { PdfPageFrame } from '../utils/pdfPreviewRender';

/** 已提交的页面只保存视图身份；离屏 canvas 移除时立即清空像素与缓存。 */
export interface RenderedPdfPage {
  key: string;
  canvas: HTMLCanvasElement;
  scale: number;
  rotation: number;
  frame?: PdfPageFrame;
  error?: string;
}

/**
 * 管理可见画布和提交帧的生命周期，不让帧提交改变渲染任务依赖。
 * @param document 当前 PDF 文档
 * @param revision 用户重试版本
 * @returns 画布注册、帧缓存、状态发布和重试入口
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
      // 像素、方向、缩放和识别框在同一布局提交中生效，不能在异步回调里先换像素。
      item.canvas.width = frame.buffer.width;
      item.canvas.height = frame.buffer.height;
      // 各页高清帧逐页提交，显示尺寸只跟随各自骨架，不能共享当前页的帧倍率。
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

/** 清空尚未提交或已离屏的缓冲区，不保留高分辨率像素副本。 */
function releaseBuffer(item: RenderedPdfPage) {
  if (item.frame) item.frame.buffer.width = item.frame.buffer.height = 0;
}
