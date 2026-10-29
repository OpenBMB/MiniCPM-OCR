import { useCallback, useRef, useState, type PointerEvent } from 'react';

interface PdfPanOrigin {
  pointerId: number;
  x: number;
  y: number;
  left: number;
  top: number;
}

/**
 * PDF 鼠标拖拽阅读；只更新原生滚动位置，不改变倍率或重绘画布。
 * @param enabled 文档就绪后允许拖拽，触屏仍使用原生滚动。
 * @returns 抓取状态和视口指针事件处理函数。
 */
export function usePdfPreviewPan(enabled: boolean) {
  const origin = useRef<PdfPanOrigin | null>(null);
  const [dragging, setDragging] = useState(false);
  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!enabled || origin.current || event.button !== 0 || event.pointerType === 'touch') return;
      const target = event.target;
      // 识别框和操作控件保留点击语义，不能被阅读拖拽捕获。
      if (
        target instanceof Element &&
        target.closest('button, a, input, select, textarea, [role="button"], [contenteditable]')
      )
        return;
      const viewport = event.currentTarget;
      if (
        viewport.scrollWidth <= viewport.clientWidth &&
        viewport.scrollHeight <= viewport.clientHeight
      )
        return;
      origin.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
      };
      viewport.setPointerCapture?.(event.pointerId);
      setDragging(true);
      event.preventDefault();
    },
    [enabled],
  );
  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const start = origin.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const viewport = event.currentTarget;
    viewport.scrollLeft = Math.max(
      0,
      Math.min(viewport.scrollWidth - viewport.clientWidth, start.left + start.x - event.clientX),
    );
    viewport.scrollTop = Math.max(
      0,
      Math.min(viewport.scrollHeight - viewport.clientHeight, start.top + start.y - event.clientY),
    );
  }, []);
  const onPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (origin.current?.pointerId !== event.pointerId) return;
    origin.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  return { dragging, onPointerDown, onPointerMove, onPointerUp };
}
