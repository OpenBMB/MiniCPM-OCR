/**
 * Wheel-gesture collection.
 *
 * Purpose: image zoom has to follow the wheel, but attaching the native wheel event directly has two pitfalls:
 * 1. React registers wheel on the root as passive, so preventDefault in a synthetic event cannot stop page scroll,
 *    and a native listener has to be attached non-passive by hand;
 * 2. one scroll can fire hundreds of events, and setState on each one drops frames on a large image — so they are coalesced on
 *    requestAnimationFrame, and the accumulated delta is applied only once per frame.
 *
 * "Currently scrolling" is also exposed: during a continuous gesture the caller should turn CSS transitions off so it follows the hand.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** In line-mode wheel (Firefox) one notch of deltaY is only ±3; convert it by line height into pixels so the feel matches. */
const LINE_HEIGHT = 16;
/** How long after scrolling stops the gesture is considered finished. */
const SETTLE_MS = 140;

/**
 * Turn the wheel on an element into a coalesced delta callback.
 * @param node target element; do not listen when null
 * @param onDelta called once per frame; delta is the accumulated pixel increment, and event is the last event of that frame
 * @returns gesturing, whether a continuous scroll is in progress
 */
export function useWheelGesture(
  node: HTMLElement | null,
  onDelta: (delta: number, event: WheelEvent) => void,
): { gesturing: boolean } {
  const [gesturing, setGesturing] = useState(false);
  const handlerRef = useRef(onDelta);
  const pendingRef = useRef<{ delta: number; event: WheelEvent } | null>(null);
  const frameRef = useRef(0);
  const settleRef = useRef(0);

  useEffect(() => {
    handlerRef.current = onDelta;
  }, [onDelta]);

  const flush = useCallback(() => {
    frameRef.current = 0;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) handlerRef.current(pending.delta, pending.event);
  }, []);

  useEffect(() => {
    if (!node) return undefined;
    function listener(event: WheelEvent) {
      event.preventDefault();
      const delta = event.deltaMode === 1 ? event.deltaY * LINE_HEIGHT : event.deltaY;
      pendingRef.current = { delta: (pendingRef.current?.delta ?? 0) + delta, event };
      setGesturing(true);
      window.clearTimeout(settleRef.current);
      settleRef.current = window.setTimeout(() => setGesturing(false), SETTLE_MS);
      if (!frameRef.current) frameRef.current = window.requestAnimationFrame(flush);
    }
    node.addEventListener('wheel', listener, { passive: false });
    return () => {
      node.removeEventListener('wheel', listener);
      window.clearTimeout(settleRef.current);
      window.cancelAnimationFrame(frameRef.current);
    };
  }, [flush, node]);

  return { gesturing };
}
