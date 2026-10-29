import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  createPdfPageRenderTask,
  createVisiblePdfGeometryKey,
  pdfError,
  type PdfPageGeometry,
} from '../utils/pdfPreviewRender';
import { usePdfPreviewFrames } from './usePdfPreviewFrames';

interface PdfPageRendererOptions {
  document?: PDFDocumentProxy;
  revision: number;
  geometries: readonly PdfPageGeometry[];
  visiblePageNumbers: number[];
  currentPage: number;
  viewportWidth: number;
  scale: number;
  rotation: number;
  loadError?: string;
  cache?: boolean;
}

/**
 * 渲染连续滚动 PDF 的可见页，并把离屏帧原子提交到对应 canvas。
 * @param options PDF 文档、页面骨架、当前页、可见页、缩放与加载错误
 * @returns 预览状态、canvas ref 注册函数与渲染状态
 */
export function usePdfPageRenderer({
  document,
  revision,
  geometries,
  visiblePageNumbers,
  currentPage,
  viewportWidth,
  scale,
  rotation,
  loadError,
  cache = false,
}: PdfPageRendererOptions) {
  const {
    canvases,
    rendered,
    getFrame,
    isCurrentCanvas,
    commitFrame,
    attempt,
    setPageCanvas,
    reset,
  } = usePdfPreviewFrames(document, revision);

  const geometryByPage = useMemo(
    () => new Map(geometries.map((item) => [item.pageNumber, item])),
    [geometries],
  );
  const geometryByPageRef = useRef(geometryByPage);
  useLayoutEffect(() => {
    geometryByPageRef.current = geometryByPage;
  }, [geometryByPage]);
  const visibleGeometryKey = useMemo(
    () => createVisiblePdfGeometryKey(geometryByPage, visiblePageNumbers),
    [geometryByPage, visiblePageNumbers],
  );

  const renderKey = useCallback(
    (pageNumber: number, geometry?: PdfPageGeometry) => {
      return `${revision}:${pageNumber}:${scale}:${rotation}:${viewportWidth}:${geometry?.width}:${geometry?.height}:${geometry?.rotation}`;
    },
    [revision, rotation, scale, viewportWidth],
  );
  // 观察器可能发布同样页码的新数组，不能因此中止仍在绘制的页面。
  const visibleKey = visiblePageNumbers.join(',');
  const targets = useMemo(
    () =>
      visibleKey
        .split(',')
        .map(Number)
        .filter((pageNumber) => pageNumber > 0),
    [visibleKey],
  );

  useEffect(() => {
    if (!document || !viewportWidth || !targets.length) return;
    let disposed = false;
    let task: ReturnType<typeof createPdfPageRenderTask> | undefined;
    const pending = [...targets]
      .sort((left, right) => Math.abs(left - currentPage) - Math.abs(right - currentPage))
      .map((pageNumber) => {
        const geometry = geometryByPageRef.current.get(pageNumber);
        const canvas = canvases[pageNumber];
        const key = renderKey(pageNumber, geometry);
        const current = getFrame(pageNumber);
        if (!geometry || !canvas || (current?.key === key && current.canvas === canvas))
          return null;
        return { pageNumber, geometry, canvas, key };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    const render = async () => {
      for (const target of pending) {
        if (disposed) return;
        const buffer = target.canvas.ownerDocument.createElement('canvas');
        let submitted = false;
        task = createPdfPageRenderTask(
          document,
          target.pageNumber,
          {
            geometry: target.geometry,
            availableWidth: viewportWidth - 32,
            scale,
            rotation,
            cacheKey: cache ? String(revision) : undefined,
          },
          buffer,
        );
        try {
          const frame = await task.promise;
          if (disposed || !isCurrentCanvas(target.pageNumber, target.canvas)) return;
          const context = target.canvas.getContext('2d');
          if (!context) throw new Error('Canvas unavailable');
          submitted = commitFrame(target.pageNumber, {
            key: target.key,
            canvas: target.canvas,
            scale,
            rotation,
            frame,
          });
        } catch (error) {
          if (!disposed) {
            const previous = getFrame(target.pageNumber);
            commitFrame(target.pageNumber, {
              key: target.key,
              canvas: target.canvas,
              scale: previous?.frame ? previous.scale : scale,
              rotation: previous?.frame ? previous.rotation : rotation,
              frame: previous?.frame,
              error: pdfError(error),
            });
          }
        } finally {
          if (!submitted) buffer.width = buffer.height = 0;
          task = undefined;
        }
      }
    };
    void render();
    return () => {
      disposed = true;
      task?.cancel();
    };
  }, [
    attempt,
    cache,
    canvases,
    commitFrame,
    currentPage,
    document,
    getFrame,
    isCurrentCanvas,
    renderKey,
    rotation,
    scale,
    targets,
    viewportWidth,
    visibleGeometryKey,
  ]);

  const active = rendered[currentPage];
  const activeKey = renderKey(currentPage, geometryByPage.get(currentPage));
  const activeError = active?.key === activeKey ? active.error : undefined;
  const hasPreview = Boolean(active?.frame && !activeError);
  const readyPageNumbers = useMemo(
    () =>
      Object.entries(rendered)
        .filter(
          ([pageNumber, item]) =>
            item.frame && !item.error && item.canvas === canvases[Number(pageNumber)],
        )
        .map(([pageNumber]) => Number(pageNumber)),
    [canvases, rendered],
  );

  return {
    setPageCanvas,
    readyPageNumbers,
    hasPreview,
    frameScale: active?.scale ?? scale,
    displayRotation: hasPreview ? active.rotation : rotation,
    rendering: !loadError && !activeError && (!hasPreview || active?.key !== activeKey),
    error: loadError ?? activeError,
    reset,
  };
}
