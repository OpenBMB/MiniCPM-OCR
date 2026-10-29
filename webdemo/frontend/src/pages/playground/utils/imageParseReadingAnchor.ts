interface ImageParseReadingCandidate {
  ids: readonly string[];
  page?: number;
  /** 块顶部相对结果滚动视口顶部的偏移。 */
  offset: number;
}

/** 结果栏在内容重排前捕获的阅读定位点。 */
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
 * 记录当前结果视口里最靠上的可定位块。
 * 页眉页脚切换只改变块内容，块的稳定 id 不会变化，因此可用它把视线锚回同一段正文。
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
    // 顶部块被隐藏时继续尝试下一段可见正文，避免锚到一个已删除的页眉。
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
 * 计算重排后的滚动位置：优先还原同一正文块，找不到时退到页首和整体进度。
 * @returns 需要写入结果视口的 scrollTop；视口不可用或没有可还原目标时返回 undefined
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
