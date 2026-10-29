import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { WHEEL_STEP } from '../utils/imageZoom';

/** 在缩放提交后修正滚动位置，让指针指向的内容保持在原视口位置。 */
function applyZoomScrollAnchor(
  viewport: HTMLElement,
  ratio: number,
  anchor: { x: number; y: number },
) {
  viewport.scrollLeft = Math.max(0, (viewport.scrollLeft + anchor.x) * ratio - anchor.x);
  viewport.scrollTop = Math.max(0, (viewport.scrollTop + anchor.y) * ratio - anchor.y);
}

/**
 * PDF 缩放控制：普通滚轮保留原生阅读，Ctrl/Meta 滚轮按帧合并缩放。
 * @param viewport PDF 阅读视口。
 * @param enabled 文档加载成功后才接管缩放手势。
 * @returns 当前倍数、按钮缩放与还原操作。
 */
export function usePdfPreviewZoom(viewport: HTMLElement | null, enabled: boolean) {
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);
  const committedScaleRef = useRef(1);
  const wheelAnchorRef = useRef<{ x: number; y: number } | undefined>(undefined);

  const commitScale = useCallback((next: number) => {
    const clamped = Math.max(0.5, Math.min(3, next));
    if (clamped === scaleRef.current) return;
    scaleRef.current = clamped;
    setScale(clamped);
  }, []);

  useLayoutEffect(() => {
    if (!viewport) return;
    const previous = committedScaleRef.current;
    if (previous === scale) return;
    committedScaleRef.current = scale;
    const ratio = scale / previous;
    const anchor = wheelAnchorRef.current ?? {
      x: viewport.clientWidth / 2,
      y: viewport.clientHeight / 2,
    };
    wheelAnchorRef.current = undefined;
    applyZoomScrollAnchor(viewport, ratio, anchor);
  }, [scale, viewport]);

  useEffect(() => {
    if (!viewport || !enabled) return;
    let delta = 0;
    let frame: number | undefined;
    const flush = () => {
      frame = undefined;
      const accumulated = delta;
      delta = 0;
      commitScale(scaleRef.current * (1 - accumulated * WHEEL_STEP));
    };
    const onWheel = (event: WheelEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || !event.deltaY) return;
      event.preventDefault();
      const bounds = viewport.getBoundingClientRect();
      wheelAnchorRef.current = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      };
      let unit = 1;
      if (event.deltaMode === 1) unit = 16;
      else if (event.deltaMode === 2) unit = Math.max(1, viewport.clientHeight);
      delta += event.deltaY * unit;
      // PDF 重绘开销较大，连续滚轮每帧只提交一次倍率更新。
      if (frame === undefined) frame = window.requestAnimationFrame(flush);
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      viewport.removeEventListener('wheel', onWheel);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [viewport, enabled, commitScale]);

  return {
    scale,
    zoomIn: () => commitScale(scaleRef.current + 0.25),
    zoomOut: () => commitScale(scaleRef.current - 0.25),
    reset: () => commitScale(1),
  };
}
