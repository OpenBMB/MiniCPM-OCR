import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { WHEEL_STEP } from '../utils/imageZoom';

/** After a zoom commit, correct the scroll position so the content under the pointer stays at its original viewport position. */
function applyZoomScrollAnchor(
  viewport: HTMLElement,
  ratio: number,
  anchor: { x: number; y: number },
) {
  viewport.scrollLeft = Math.max(0, (viewport.scrollLeft + anchor.x) * ratio - anchor.x);
  viewport.scrollTop = Math.max(0, (viewport.scrollTop + anchor.y) * ratio - anchor.y);
}

/**
 * PDF zoom control: an ordinary wheel keeps native reading, and a Ctrl/Meta wheel merges zoom by frame.
 * @param viewport PDF reading viewport.
 * @param enabled take over the zoom gesture only after the document has loaded successfully.
 * @returns the current scale, button zoom, and the reset action.
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
      // PDF redraw is expensive, so a continuous wheel submits only one scale update per frame.
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
