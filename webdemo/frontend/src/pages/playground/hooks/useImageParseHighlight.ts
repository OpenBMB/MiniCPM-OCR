import { useEffect, useRef, type RefObject } from 'react';
import type { ImageParseLinkedRange } from '../utils/imageParseHighlight';
import type { ImageParseTextRange } from '../utils/imageParseBlocks';

/**
 * Update the selected marker and scroll position of mapped nodes, without re-parsing Markdown, formulas, and code.
 * While the preview is hidden, update only the marker, and position again after switching back to the preview, so it does not scroll to an invisible node.
 */
export function useImageParseHighlight(
  ref: RefObject<HTMLElement | null>,
  selectedId: string | undefined,
  focusRequest: number | undefined,
  content: string,
  links: readonly ImageParseLinkedRange[] | undefined,
  tab: string | undefined,
  range?: ImageParseTextRange,
  linked = true,
  hoveredId?: string,
  scrollResultTo?: (top: number) => void,
) {
  const consumedFocus = useRef<{ id: string; request: number } | undefined>(undefined);
  useEffect(() => {
    function updateMarkers() {
      const nodes = ref.current?.querySelectorAll<HTMLElement>('[data-ocr-linked-ids]');
      let selected: HTMLElement | undefined;
      nodes?.forEach((node) => {
        const ids: string[] = JSON.parse(node.dataset.ocrLinkedIds!);
        if (selectedId && ids.includes(selectedId)) {
          node.dataset.ocrHighlight = 'true';
          selected ??= node;
        } else node.removeAttribute('data-ocr-highlight');
        if (hoveredId && ids.includes(hoveredId)) node.dataset.ocrHover = 'true';
        else node.removeAttribute('data-ocr-hover');
      });
      if (!links?.length && range) {
        selected = ref.current?.querySelector<HTMLElement>('[data-ocr-highlight]') ?? undefined;
      }
      return selected;
    }
    const selected = updateMarkers();
    if (
      linked &&
      selected &&
      selectedId &&
      focusRequest &&
      (!tab || tab === 'preview') &&
      (consumedFocus.current?.id !== selectedId || consumedFocus.current.request !== focusRequest)
    ) {
      const viewport = ref.current?.closest<HTMLElement>('[data-ocr-result-scroll]');
      if (viewport) {
        const next = centeredScrollTop(viewport, selected);
        if (Math.abs(next - viewport.scrollTop) > 0.5) {
          if (scrollResultTo) scrollResultTo(next);
          else viewport.scrollTo({ top: next, behavior: 'instant' });
        }
        consumedFocus.current = { id: selectedId, request: focusRequest };
      }
    }
    const element = ref.current;
    if (!element) return;
    // Leaving edit with no change also remounts preview nodes; observe only structural changes, so a marker update does not trigger an observation loop.
    const observer = new MutationObserver((records) => {
      if (
        records.some(
          ({ target }) =>
            !(target instanceof Element) || !target.closest('[data-visual-editing="true"]'),
        )
      )
        updateMarkers();
    });
    observer.observe(element, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [
    ref,
    selectedId,
    focusRequest,
    content,
    links,
    tab,
    range,
    linked,
    hoveredId,
    scrollResultTo,
  ]);
}

/** Compute the position that centers a result block inside the current scroll container, so the scroll chain does not affect the page outside the workspace. */
function centeredScrollTop(viewport: HTMLElement, target: HTMLElement): number {
  const bounds = viewport.getBoundingClientRect();
  const viewportHeight = viewport.clientHeight || bounds.height;
  const targetBounds = target.getBoundingClientRect();
  if (!viewportHeight) return viewport.scrollTop + targetBounds.top - bounds.top;
  const targetCenter = targetBounds.top - bounds.top + targetBounds.height / 2;
  const maxScrollTop = Math.max(0, viewport.scrollHeight - viewportHeight);
  return Math.max(
    0,
    Math.min(maxScrollTop, viewport.scrollTop + targetCenter - viewportHeight / 2),
  );
}
