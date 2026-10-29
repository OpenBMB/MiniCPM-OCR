import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
  type VirtualItem,
} from '@tanstack/react-virtual';

import type { useImageParse } from './useImageParse';

type PdfState = NonNullable<ReturnType<typeof useImageParse>['pdf']>;

/** 连续结果按页测量并缓存高度；编辑页与当前定位页必须保持挂载。 */
export function useImageParsePdfPreview(
  pdf: PdfState,
  pageKey: (page: number) => string,
  root: RefObject<HTMLElement | null>,
  active: boolean,
  linked: boolean,
  focusRequest?: number,
  onFocus?: (top: number) => void,
) {
  const [editing, setEditing] = useState<ReadonlySet<number>>(new Set());
  const { setPage } = pdf;
  const reportedPage = useRef(pdf.page);
  const previousPage = useRef(0);
  const previousFocus = useRef(focusRequest);
  // 保留全部页骨架；未完成页显示等待态，左右滚动才能始终按页码联动。
  const pages = useMemo(
    () => Array.from({ length: pdf.pages }, (_, index) => index + 1),
    [pdf.pages],
  );
  const virtualized = pages.length >= 12;
  const getItemKey = useCallback((index: number) => pageKey(pages[index]!), [pageKey, pages]);
  const rangeExtractor = useCallback(
    (range: Range) =>
      [
        ...new Set([
          ...defaultRangeExtractor(range),
          pages.indexOf(pdf.page),
          ...[...editing].map((page) => pages.indexOf(page)),
        ]),
      ]
        .filter((index) => index >= 0 && index < pages.length)
        .sort((a, b) => a - b),
    [editing, pdf.page, pages],
  );
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLElement>({
    count: pages.length,
    getScrollElement: () =>
      root.current?.closest<HTMLDivElement>('[data-ocr-result-scroll]') ?? null,
    estimateSize: () => 720,
    getItemKey,
    rangeExtractor,
    overscan: 2,
    enabled: virtualized,
    initialRect: { width: 600, height: 800 },
    paddingStart: 0,
    measureElement: (element, entry, instance) => {
      const height = entry?.borderBoxSize?.[0]?.blockSize ?? element.getBoundingClientRect().height;
      // 标签隐藏时 ResizeObserver 报零高度，不能清掉已测量的页面尺寸。
      return (
        height || instance.itemSizeCache.get(pageKey(Number(element.dataset.ocrResultPage))) || 720
      );
    },
  });
  const virtualItems = virtualizer.getVirtualItems();
  const items: readonly VirtualItem[] = (() => {
    if (virtualItems.length) return virtualItems;
    if (!virtualized || !pages.length) return [];
    const size = virtualizer.itemSizeCache.get(pageKey(pdf.page)) ?? 720;
    return [
      {
        index: Math.max(0, pages.indexOf(pdf.page)),
        key: pageKey(pdf.page),
        start: 0,
        size,
        end: size,
        lane: 0,
      },
    ];
  })();
  const mounted = new Set(items.map((item) => pages[item.index]));
  const onEditingChange = useCallback((page: number, value: boolean) => {
    setEditing((previous) => {
      if (previous.has(page) === value) return previous;
      const next = new Set(previous);
      if (value) next.add(page);
      else next.delete(page);
      return next;
    });
  }, []);
  const updatePage = useCallback(() => {
    const viewport = root.current?.closest<HTMLElement>('[data-ocr-result-scroll]');
    if (!viewport || !active) return;
    const requested = viewport.dataset.ocrProgrammaticTop;
    delete viewport.dataset.ocrProgrammaticTop;
    if (requested !== undefined && Math.abs(viewport.scrollTop - Number(requested)) < 1) return;
    const top = viewport.getBoundingClientRect().top;
    const center = top + viewport.clientHeight / 2;
    let nearest = pdf.page;
    let distance = Infinity;
    root.current?.querySelectorAll<HTMLElement>('[data-ocr-result-page]').forEach((node) => {
      const rect = node.getBoundingClientRect();
      const gap = Math.max(rect.top - center, center - rect.bottom, 0);
      if (gap < distance) {
        nearest = Number(node.dataset.ocrResultPage);
        distance = gap;
      }
    });
    reportedPage.current = nearest;
    if (nearest !== pdf.page) setPage(nearest);
  }, [active, pdf.page, setPage, root]);
  useLayoutEffect(() => {
    const viewport = root.current?.closest<HTMLElement>('[data-ocr-result-scroll]');
    if (!viewport) return;
    viewport.addEventListener('scroll', updatePage, { passive: true });
    return () => viewport.removeEventListener('scroll', updatePage);
  }, [root, updatePage]);

  useLayoutEffect(() => {
    if (!active) return;
    const changed = previousPage.current !== pdf.page;
    const focusing = previousFocus.current !== focusRequest && Boolean(focusRequest);
    previousPage.current = pdf.page;
    previousFocus.current = focusRequest;
    if (!changed || !linked || focusing || reportedPage.current === pdf.page) return;
    const viewport = root.current?.closest<HTMLElement>('[data-ocr-result-scroll]');
    const target = root.current?.querySelector<HTMLElement>(`[data-ocr-result-page="${pdf.page}"]`);
    if (!viewport || !target) return;
    const bounds = viewport.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    if (rect.bottom > bounds.top && rect.top < bounds.bottom) return;
    const top = viewport.scrollTop + rect.top - bounds.top - 16;
    if (onFocus) onFocus(top);
    else viewport.scrollTop = top;
  }, [active, linked, focusRequest, pdf.page, root, onFocus]);

  return {
    pages,
    items,
    totalSize: virtualizer.getTotalSize(),
    virtualized,
    onEditingChange,
    measure: virtualizer.measureElement,
    mounted: (page: number) =>
      !virtualized || page === pdf.page || editing.has(page) || mounted.has(page),
    height: (page: number) => virtualizer.itemSizeCache.get(pageKey(page)) ?? 720,
  };
}
