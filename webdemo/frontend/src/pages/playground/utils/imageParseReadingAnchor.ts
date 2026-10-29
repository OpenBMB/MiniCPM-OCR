interface ImageParseReadingCandidate {
  ids: readonly string[];
  page?: number;
  /** Offset of the block top relative to the top of the result scroll viewport. */
  offset: number;
}

/** Reading anchor captured in the result column before content is reflowed. */
export interface ImageParseReadingAnchor {
  candidates: readonly ImageParseReadingCandidate[];
  page?: number;
  pageOffset: number;
  progress: number;
}

function linkedIds(node: HTMLElement): string[] {
  try {
    const parsed: unknown = JSON.parse(node.dataset.ocrLinkedIds ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : [];
  } catch {
    return [];
  }
}

function pageOf(node: HTMLElement): number | undefined {
  const value = node.closest<HTMLElement>('[data-ocr-result-page]')?.dataset.ocrResultPage;
  if (value === undefined) return undefined;
  const page = Number(value);
  return Number.isFinite(page) ? page : undefined;
}

/**
 * Record the topmost positionable block in the current result viewport.
 * Toggling header and footer only changes block content; a block's stable id does not change, so it can anchor the view back to the same body text.
 */
export function captureImageParseReadingAnchor(
  viewport: HTMLElement,
): ImageParseReadingAnchor | undefined {
  const viewportBounds = viewport.getBoundingClientRect();
  const viewportHeight = viewport.clientHeight || viewportBounds.height;
  if (!viewportHeight) return undefined;
  const top = viewportBounds.top;
  const bottom = top + viewportHeight;
  const candidates: ImageParseReadingCandidate[] = [];
  viewport.querySelectorAll<HTMLElement>('[data-ocr-linked-ids]').forEach((node) => {
    if (node.closest('[data-visual-editing="true"]')) return;
    const bounds = node.getBoundingClientRect();
    if (!bounds.height || bounds.bottom <= top || bounds.top >= bottom) return;
    const ids = linkedIds(node);
    if (!ids.length) return;
    candidates.push({
      ids,
      page: pageOf(node),
      offset: bounds.top - top,
    });
  });
  candidates.sort((left, right) => left.offset - right.offset);

  let page: number | undefined;
  let pageOffset = 0;
  let nearest = Infinity;
  viewport.querySelectorAll<HTMLElement>('[data-ocr-result-page]').forEach((node) => {
    const bounds = node.getBoundingClientRect();
    if (!bounds.height) return;
    let distance = 0;
    if (bounds.top > top) distance = bounds.top - top;
    else if (bounds.bottom < top) distance = top - bounds.bottom;
    if (distance >= nearest) return;
    nearest = distance;
    page = Number(node.dataset.ocrResultPage);
    pageOffset = bounds.top - top;
  });

  const range = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  return {
    // When the top block is hidden, keep trying the next visible body text, so the anchor does not land on a header that was removed.
    candidates: candidates.slice(0, 12),
    page: Number.isFinite(page) ? page : undefined,
    pageOffset,
    progress: range ? Math.max(0, Math.min(1, viewport.scrollTop / range)) : 0,
  };
}

function findCandidateNode(
  viewport: HTMLElement,
  candidate: ImageParseReadingCandidate,
): HTMLElement | undefined {
  for (const node of viewport.querySelectorAll<HTMLElement>('[data-ocr-linked-ids]')) {
    if (candidate.page !== undefined && pageOf(node) !== candidate.page) continue;
    const ids = linkedIds(node);
    if (candidate.ids.some((id) => ids.includes(id))) return node;
  }
  return undefined;
}

/**
 * Compute the scroll position after reflow: restore the same body block first, and fall back to the top of the page and overall progress when it cannot be found.
 * @returns scrollTop to write into the result viewport; undefined when the viewport is unavailable or there is no target to restore
 */
export function resolveImageParseReadingTop(
  viewport: HTMLElement,
  anchor: ImageParseReadingAnchor,
): number | undefined {
  const viewportBounds = viewport.getBoundingClientRect();
  if (!(viewport.clientHeight || viewportBounds.height)) return undefined;
  const range = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  const scrollTo = (top: number) => Math.max(0, Math.min(range, top));

  for (const candidate of anchor.candidates) {
    const node = findCandidateNode(viewport, candidate);
    if (!node) continue;
    const bounds = node.getBoundingClientRect();
    return scrollTo(viewport.scrollTop + bounds.top - viewportBounds.top - candidate.offset);
  }

  if (anchor.page !== undefined) {
    const node = viewport.querySelector<HTMLElement>(
      `[data-ocr-result-page="${anchor.page}"]`,
    );
    if (node) {
      const bounds = node.getBoundingClientRect();
      return scrollTo(viewport.scrollTop + bounds.top - viewportBounds.top - anchor.pageOffset);
    }
  }

  return scrollTo(anchor.progress * range);
}
