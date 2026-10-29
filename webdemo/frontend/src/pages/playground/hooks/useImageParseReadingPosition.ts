import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  captureImageParseReadingAnchor,
  resolveImageParseReadingTop,
  type ImageParseReadingAnchor,
} from '../utils/imageParseReadingAnchor';

interface ImageParseReadingPositionOptions {
  /** Identity of the current page or the current result; recapture when the page or file changes, and do not jump across documents. */
  resultKey: string;
  /** A switch that only changes what is shown and needs to keep the reading position, such as header and footer. */
  preserveKey: unknown;
  /** Use the programmatic scroll entry the result column already has, so linking does not rewrite the original column as well. */
  scrollTo?: (top: number) => void;
}

/**
 * Keep the result column's reading position across a content-switch toggle.
 * Both capture and restore finish in the layout phase, so content after a jump is not painted before the scroll.
 */
export function useImageParseReadingPosition({
  resultKey,
  preserveKey,
  scrollTo,
}: ImageParseReadingPositionOptions) {
  const [viewport, setViewport] = useState<HTMLElement | null>(null);
  const anchor = useRef<ImageParseReadingAnchor | undefined>(undefined);
  const previousViewport = useRef<HTMLElement | null>(null);
  const previousResultKey = useRef(resultKey);
  const previousPreserveKey = useRef(preserveKey);
  const pendingCapture = useRef<number | undefined>(undefined);
  const viewportRef = useCallback((node: HTMLElement | null) => setViewport(node), []);

  const capture = useCallback(() => {
    if (!viewport) return;
    const next = captureImageParseReadingAnchor(viewport);
    // When the tab is hidden the viewport height is 0; keep the anchor from the last time it was visible.
    if (next) anchor.current = next;
  }, [viewport]);

  useEffect(() => {
    if (!viewport) return;
    capture();
    const onScroll = () => {
      if (pendingCapture.current !== undefined) return;
      pendingCapture.current = requestAnimationFrame(() => {
        pendingCapture.current = undefined;
        capture();
      });
    };
    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      viewport.removeEventListener('scroll', onScroll);
      if (pendingCapture.current !== undefined) cancelAnimationFrame(pendingCapture.current);
      pendingCapture.current = undefined;
    };
  }, [capture, viewport]);

  useLayoutEffect(() => {
    if (!viewport) return;
    if (previousViewport.current !== viewport) {
      previousViewport.current = viewport;
      previousResultKey.current = resultKey;
      previousPreserveKey.current = preserveKey;
      anchor.current = undefined;
      capture();
      return;
    }
    if (previousResultKey.current !== resultKey) {
      previousResultKey.current = resultKey;
      previousPreserveKey.current = preserveKey;
      anchor.current = undefined;
      capture();
      return;
    }
    if (previousPreserveKey.current !== preserveKey) {
      previousPreserveKey.current = preserveKey;
      const previous = anchor.current;
      if (previous) {
        const top = resolveImageParseReadingTop(viewport, previous);
        if (top !== undefined) {
          if (scrollTo) scrollTo(top);
          else viewport.scrollTo({ top, behavior: 'instant' });
        }
        capture();
      }
      return;
    }
    if (!anchor.current) capture();
  }, [capture, preserveKey, resultKey, scrollTo, viewport]);

  return { viewportRef };
}
