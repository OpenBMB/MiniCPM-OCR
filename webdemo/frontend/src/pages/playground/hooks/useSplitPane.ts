/**
 * Dragging a left-right comparison split.
 *
 * Purpose: while reading side by side, whether the original image or the result should take more width depends on the image itself — a vertical table wants more for the original,
 * and a page of text wants more for the Markdown. A fixed 50/50 decides that for the user.
 *
 * Dragging uses Pointer Events plus setPointerCapture: one capture lasts to the end,
 * so the pointer leaving the divider or even the window does not drop events, and there is no global listener on window to remember to remove.
 *
 * On press, record the pointer, the ratio, and the container width, and convert movement from the displacement, so pressing from the edge of the transparent grab area does not jump.
 */

import { useCallback, useRef, useState } from 'react';

/** Upper and lower bounds of the left-pane ratio, so neither side can be dragged until it is unusable. */
const MIN_RATIO = 24;
const MAX_RATIO = 76;
/** Step for each keyboard adjustment. */
const KEY_STEP = 2;
/** Container marker attribute; the divider uses it to find which width it should convert against. */
const CONTAINER_ATTR = 'data-split-container';

/** Split controls. */
export interface SplitPane {
  /** Left-pane ratio (percent) */
  ratio: number;
  /** Whether a drag is in progress. The split-width transition must be turned off while dragging, or the pane width lags the pointer by one step */
  dragging: boolean;
  /** Spread onto the split container so the divider can find it */
  containerProps: Record<string, string>;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  /** Double-click the divider to return to an even split */
  reset: () => void;
  min: number;
  max: number;
}

function clamp(value: number): number {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, value));
}

/**
 * A draggable split.
 * @param initial initial left-pane ratio; even split by default
 */
export function useSplitPane(initial = 50): SplitPane {
  const [ratio, setRatio] = useState(clamp(initial));
  const [dragging, setDragging] = useState(false);
  // Save the drag snapshot synchronously between events, so a delayed state update or a second finger does not change this drag.
  const dragRef = useRef<{
    pointerId: number;
    clientX: number;
    ratio: number;
    width: number;
  } | null>(null);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || dragRef.current) return;
    const target = event.currentTarget;
    const containerRect = target
      .closest<HTMLElement>(`[${CONTAINER_ATTR}]`)
      ?.getBoundingClientRect();
    const dividerRect = target.getBoundingClientRect();
    const width = containerRect?.width ?? 0;
    if (!containerRect || width <= 0) return;
    // A negative margin makes the divider's right edge meet the original-image pane boundary, continuing an unfinished width transition for the current layout.
    const ratio = clamp(
      ((dividerRect.left + dividerRect.width - containerRect.left) / width) * 100,
    );
    target.setPointerCapture(event.pointerId);
    target.focus({ preventScroll: true });
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, ratio, width };
    setRatio(ratio);
    setDragging(true);
    event.preventDefault();
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    setRatio(clamp(drag.ratio + ((event.clientX - drag.clientX) / drag.width) * 100));
  }, []);

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current || event.pointerId !== dragRef.current.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowLeft') setRatio((current) => clamp(current - KEY_STEP));
    else if (event.key === 'ArrowRight') setRatio((current) => clamp(current + KEY_STEP));
    else if (event.key === 'Home') setRatio(MIN_RATIO);
    else if (event.key === 'End') setRatio(MAX_RATIO);
    else return;
    event.preventDefault();
  }, []);

  const reset = useCallback(() => setRatio(50), []);

  return {
    ratio,
    dragging,
    containerProps: { [CONTAINER_ATTR]: '' },
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onKeyDown,
    reset,
    min: MIN_RATIO,
    max: MAX_RATIO,
  };
}
