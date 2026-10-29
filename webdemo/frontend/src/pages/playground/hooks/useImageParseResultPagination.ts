import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/** PDF page state and result identity, used to continue reading in the existing single-page result column. */
export interface ImageParseResultPaginationOptions {
  pdf?: { page: number; pages: number; setPage: (page: number) => void };
  resultKeyForPage: (page?: number) => string;
  markdown: string;
}

type PageEntry = { key: string; previousKey: string; edge: 0 | 1 };
const GESTURE_IDLE_MS = 160;
const PAGE_TURN_INTERVAL_MS = 320;

/**
 * Turn the page when the current-page preview reaches an edge; body scroll, editing, and zoom keep using native interaction.
 * @param resultKey current result identity
 * @param options PDF page number and result identity
 * @param onEnter after the new page mounts, position at the start or the end of the page
 * @returns the result-column root ref; an empty page and a failed page can also receive the page-turn gesture
 */
export function useImageParseResultPagination(
  resultKey: string,
  options: ImageParseResultPaginationOptions | undefined,
  onEnter: (edge: 0 | 1) => boolean,
) {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const entry = useRef<PageEntry | undefined>(undefined);
  const lastWheel = useRef(-Infinity);
  const lastTurn = useRef(-Infinity);
  const gestureLocked = useRef(false);
  const pdf = options?.pdf;
  const page = pdf?.page;
  const pages = pdf?.pages;
  const setPage = pdf?.setPage;
  const pageKey = options?.resultKeyForPage;
  const markdown = options?.markdown;
  const resultPaneRef = useCallback((node: HTMLElement | null) => setRoot(node), []);

  useLayoutEffect(() => {
    if (!root || !page || !pages || !setPage || !pageKey) return;
    const onWheel = (event: WheelEvent) => {
      if (
        root.dataset.ocrResultTab !== 'preview' ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        !event.deltaY ||
        Math.abs(event.deltaX) >= Math.abs(event.deltaY)
      )
        return;
      const target = event.target;
      if (
        target instanceof Element &&
        (target.closest(
          '[data-visual-editing="true"], input, textarea, select, [contenteditable="true"]',
        ) ||
          root.querySelector('[data-visual-editing="true"]'))
      )
        return;
      const viewport = root.querySelector<HTMLElement>('[data-ocr-result-scroll]');
      if (viewport && (!(target instanceof Node) || !viewport.contains(target))) return;
      // A nested table or code scroll area should not trigger a whole-page switch.
      if (target instanceof HTMLElement) {
        for (
          let node: HTMLElement | null = target;
          node && node !== viewport && node !== root;
          node = node.parentElement
        ) {
          if (
            node.scrollHeight > node.clientHeight + 1 &&
            /auto|scroll/.test(getComputedStyle(node).overflowY)
          )
            return;
        }
      }
      const now = Date.now();
      if (
        now - lastWheel.current > GESTURE_IDLE_MS &&
        now - lastTurn.current >= PAGE_TURN_INTERVAL_MS
      )
        gestureLocked.current = false;
      lastWheel.current = now;
      if (
        entry.current &&
        entry.current.key !== resultKey &&
        entry.current.previousKey === resultKey
      ) {
        event.preventDefault();
        return;
      }
      const range = viewport ? Math.max(0, viewport.scrollHeight - viewport.clientHeight) : 0;
      const top = viewport?.scrollTop ?? 0;
      const direction = event.deltaY > 0 ? 1 : -1;
      if ((direction > 0 && range - top > 1) || (direction < 0 && top > 1)) return;
      const next = page + direction;
      if (next < 1 || next > pages) return;
      event.preventDefault();
      // One trackpad inertia gesture crosses only one page, so a short page does not keep jumping to the end of the document.
      if (gestureLocked.current) return;
      entry.current = { key: pageKey(next), previousKey: resultKey, edge: direction > 0 ? 0 : 1 };
      gestureLocked.current = true;
      lastTurn.current = now;
      setPage(next);
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, [root, page, pages, setPage, pageKey, resultKey]);

  useLayoutEffect(() => {
    const pending = entry.current;
    if (!root || !pending) return;
    if (pending.key !== resultKey) {
      if (pending.previousKey !== resultKey) entry.current = undefined;
      return;
    }
    // The left page-number position is committed on the next frame, then the right entry is restored, so the old page's confirmation does not cover the bottom of the new page.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (entry.current === pending && onEnter(pending.edge)) entry.current = undefined;
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [root, resultKey, markdown, onEnter]);

  return resultPaneRef;
}
