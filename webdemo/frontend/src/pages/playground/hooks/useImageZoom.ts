/**
 * 图片视图接线：文档模式贴合顶部、滚轮阅读与 Ctrl/Meta 缩放；交互及 resize 保持边界。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageZoom } from './imageZoomTypes';
import { useElementSize } from './useElementSize';
import { useWheelGesture } from './useWheelGesture';
import * as geometry from '../utils/imageZoom';
import type { ImageZoomView, Point } from '../utils/imageZoom';

export type { ImageZoom };

/**
 * 图片视图控制。setViewport/setContent 分别测量裁剪视口和未缩放的内容。
 */
export function useImageZoom({
  fitWidth: documentMode = false,
}: { fitWidth?: boolean } = {}): ImageZoom {
  const [storedView, setView] = useState<ImageZoomView>(geometry.INITIAL_VIEW);
  const [fitting, setFitting] = useState(documentMode);
  const [dragging, setDragging] = useState(false);
  const [viewport, setViewport] = useState<HTMLElement | null>(null);
  const [content, setContent] = useState<HTMLElement | null>(null);
  const viewportSize = useElementSize(viewport);
  const contentSize = useElementSize(content);
  const [measured, setMeasured] = useState({ viewport: viewportSize, content: contentSize });
  const originRef = useRef<Point | null>(null);
  const horizontalRef = useRef(0);
  const clamp = documentMode ? geometry.clampDocumentView : geometry.clampView;
  const view = fitting
    ? geometry.fitWidthView(storedView, viewportSize, contentSize)
    : clamp(storedView, viewportSize, contentSize);

  // 尺寸快照变化时同步调整状态，避免 resize 后下一次放大恢复旧的越界偏移。
  if (measured.viewport !== viewportSize || measured.content !== contentSize) {
    setMeasured({ viewport: viewportSize, content: contentSize });
    setView((current) =>
      fitting
        ? geometry.fitWidthView(current, viewportSize, contentSize)
        : clamp(current, viewportSize, contentSize),
    );
  }
  // 横向增量单独累积；共享滚轮采集器只合并纵向值，不能用最后一帧覆盖横向输入。
  useEffect(() => {
    if (!viewport) return;
    const collect = (event: WheelEvent) => {
      const unit = event.deltaMode === 1 ? 16 : 1;
      horizontalRef.current += event.deltaX * unit;
    };
    viewport.addEventListener('wheel', collect, { passive: true });
    return () => {
      viewport.removeEventListener('wheel', collect);
      horizontalRef.current = 0;
    };
  }, [viewport]);

  const commit = useCallback(
    (next: (current: ImageZoomView) => ImageZoomView) => {
      setFitting(false);
      setView((current) => {
        const bounded = fitting
          ? geometry.fitWidthView(current, viewportSize, contentSize)
          : clamp(current, viewportSize, contentSize);
        return clamp(next(bounded), viewportSize, contentSize);
      });
    },
    [clamp, contentSize, fitting, viewportSize],
  );

  const { gesturing } = useWheelGesture(
    viewport,
    useCallback(
      (delta: number, event: WheelEvent) => {
        const dx = horizontalRef.current;
        horizontalRef.current = 0;
        if (event.ctrlKey || event.metaKey) {
          const anchor = geometry.anchorFromCenter(event, viewport?.getBoundingClientRect());
          commit((v) => geometry.scaleTo(v, v.scale * (1 - delta * geometry.WHEEL_STEP), anchor));
        } else {
          const dy = event.deltaMode === 2 ? delta * viewportSize.height : delta;
          commit((v) => geometry.panBy(v, event.shiftKey ? -dy : -dx, event.shiftKey ? 0 : -dy));
        }
      },
      [commit, viewport, viewportSize.height],
    ),
  );

  const reset = useCallback(() => {
    setFitting(documentMode);
    setView(geometry.INITIAL_VIEW);
  }, [documentMode]);
  const zoomIn = useCallback(
    () => commit((v) => geometry.scaleTo(v, geometry.buttonScale(v.scale, 1), null)),
    [commit],
  );
  const zoomOut = useCallback(
    () => commit((v) => geometry.scaleTo(v, geometry.buttonScale(v.scale, -1), null)),
    [commit],
  );
  const fitWidth = useCallback(() => {
    setFitting(true);
    setView((v) => geometry.fitWidthView(v, viewportSize, contentSize));
  }, [contentSize, viewportSize]);
  const scrollToProgress = useCallback(
    (progress: number) =>
      commit((v) => geometry.viewAtDocumentProgress(v, viewportSize, contentSize, progress)),
    [commit, contentSize, viewportSize],
  );
  const rotate = useCallback(
    (direction: 1 | -1 = 1) => commit((v) => geometry.rotateView(v, direction)),
    [commit],
  );
  const focusBlock = useCallback(
    (
      block: { x: number; y: number; w: number; h: number },
      onPosition?: (progress: number) => void,
    ) => {
      if (!viewportSize.width || !contentSize.width) return false;
      const next = geometry.focusBlockView(block, view, viewportSize, contentSize);
      onPosition?.(geometry.documentScrollProgress(next, viewportSize, contentSize));
      commit(() => next);
      return true;
    },
    [commit, contentSize, viewportSize, view],
  );

  const onDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (view.scale > geometry.FIT_SCALE) {
        if (documentMode) fitWidth();
        else commit(geometry.resetZoom);
        return;
      }
      const anchor = geometry.anchorFromCenter(event, viewport?.getBoundingClientRect());
      commit((v) => geometry.scaleTo(v, geometry.DOUBLE_CLICK_SCALE, anchor));
    },
    [commit, documentMode, fitWidth, view.scale, viewport],
  );

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    originRef.current = { x: event.clientX, y: event.clientY };
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const origin = originRef.current;
      if (!origin) return;
      const dx = event.clientX - origin.x;
      const dy = event.clientY - origin.y;
      originRef.current = { x: event.clientX, y: event.clientY };
      commit((v) => geometry.panBy(v, dx, dy));
    },
    [commit],
  );

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!originRef.current) return;
    originRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const baseline = documentMode
    ? geometry.fitWidthView(geometry.INITIAL_VIEW, viewportSize, contentSize)
    : geometry.INITIAL_VIEW;
  return {
    scale: view.scale,
    rotation: view.rotation,
    transform: geometry.viewTransform(view, viewportSize, contentSize),
    raster: geometry.imageRasterView(view, viewportSize, contentSize),
    animated: !documentMode && !dragging && !gesturing,
    transformed: geometry.isTransformed({
      ...view,
      scale: view.scale / baseline.scale,
      offset: { x: view.offset.x - baseline.offset.x, y: view.offset.y - baseline.offset.y },
    }),
    dragging,
    zoomIn,
    zoomOut,
    fitWidth,
    focusBlock,
    scrollProgress: geometry.documentScrollProgress(view, viewportSize, contentSize),
    scrollToProgress,
    rotate,
    reset,
    setViewport,
    setContent,
    onDoubleClick,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
