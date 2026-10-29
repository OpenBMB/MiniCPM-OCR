import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { loadPdfPreview } from '../utils/pdfPreview';
import {
  getNearestPdfPage,
  measurePdfPageGeometries,
  pdfError,
  type PdfPageGeometry,
} from '../utils/pdfPreviewRender';

interface PdfLoaded {
  source: string;
  revision: number;
  document?: PDFDocumentProxy;
  error?: string;
}

/**
 * 管理 PDF 文档与连续滚动页面骨架。
 * @param source PDF 地址或 data URL
 * @param selectedPage 外部要求定位的页码
 * @param onPageChange 当前页变化回调
 * @returns 文档、页面尺寸、页码、可见页与滚动操作
 */
export function usePdfPreviewPages(
  source: string,
  selectedPage?: number,
  onPageChange?: (page: number) => void,
  followSelectedPage = true,
) {
  const [loaded, setLoaded] = useState<PdfLoaded>();
  const [measured, setMeasured] = useState<{
    source: string;
    revision: number;
    geometries: PdfPageGeometry[];
  }>();
  const [page, setPage] = useState(selectedPage && selectedPage > 0 ? selectedPage : 1);
  const [revision, setRevision] = useState(0);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [visiblePages, setVisiblePages] = useState<number[]>([]);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pageNodes = useRef(new Map<number, HTMLElement>());
  const observed = useRef(new Set<number>());
  const currentLoad =
    loaded?.source === source && loaded.revision === revision ? loaded : undefined;
  const anchorPageRef = useRef(page);
  const document = currentLoad?.document;
  const geometries = useMemo(
    () =>
      measured?.source === source && measured.revision === revision ? measured.geometries : [],
    [measured, revision, source],
  );

  const setViewportNode = useCallback((node: HTMLDivElement | null) => {
    viewportRef.current = node;
    setViewport(node);
  }, []);

  const setPageNode = useCallback((pageNumber: number, node: HTMLElement | null) => {
    if (node) pageNodes.current.set(pageNumber, node);
    else pageNodes.current.delete(pageNumber);
  }, []);

  useEffect(() => {
    let disposed = false;
    observed.current.clear();
    const task = loadPdfPreview(source);
    void task.promise
      .then((pdf) => {
        if (!disposed) setLoaded({ source, revision, document: pdf });
      })
      .catch((error: unknown) => {
        if (!disposed) setLoaded({ source, revision, error: pdfError(error) });
      });
    return () => {
      disposed = true;
      void task.destroy().catch(() => undefined);
    };
  }, [source, revision]);

  const viewportWidth = viewport?.clientWidth ?? 0;
  useLayoutEffect(() => {
    anchorPageRef.current = page;
  }, [page]);

  useEffect(() => {
    if (!document || !viewportWidth) return;
    const task = measurePdfPageGeometries({
      document,
      anchorPage: anchorPageRef.current,
      onInitial: (geometries) => setMeasured({ source, revision, geometries }),
      onUpdate: (geometries) =>
        setMeasured((current) =>
          current?.source === source && current.revision === revision
            ? { ...current, geometries }
            : current,
        ),
      onError: (error) => setLoaded({ source, revision, error: pdfError(error) }),
    });
    return () => task.cancel();
  }, [document, revision, source, viewportWidth]);

  useEffect(() => {
    if (!viewport || !geometries.length || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const next = new Set(observed.current);
        entries.forEach((entry) => {
          const pageNumber = Number(entry.target.getAttribute('data-pdf-page'));
          if (!Number.isInteger(pageNumber)) return;
          if (entry.isIntersecting) next.add(pageNumber);
          else next.delete(pageNumber);
        });
        observed.current = next;
        setVisiblePages([...next].sort((left, right) => left - right));
      },
      { root: viewport, rootMargin: '100% 0px' },
    );
    geometries.forEach(({ pageNumber }) => {
      const node = pageNodes.current.get(pageNumber);
      if (node) observer.observe(node);
    });
    return () => observer.disconnect();
  }, [viewport, geometries]);

  const onViewportScroll = useCallback(() => {
    const node = viewportRef.current;
    if (!node) return;
    const center = node.scrollTop + node.clientHeight / 2;
    const nextPage = getNearestPdfPage(page, geometries.length, center, pageNodes.current);
    if (nextPage !== page) {
      setPage(nextPage);
      onPageChange?.(nextPage);
    }
  }, [geometries.length, page, onPageChange]);

  const goTo = useCallback(
    (next: number) => {
      if (!Number.isInteger(next) || next < 1 || next > geometries.length) return;
      const node = viewportRef.current;
      const target = pageNodes.current.get(next);
      if (node && target) node.scrollTop = Math.max(0, target.offsetTop - 16);
      if (next !== page) {
        setPage(next);
        onPageChange?.(next);
      }
    },
    [geometries.length, onPageChange, page],
  );

  const activatePage = useCallback(
    (next: number) => {
      if (!Number.isInteger(next) || next < 1 || next > geometries.length || next === page) return;
      setPage(next);
      onPageChange?.(next);
    },
    [geometries.length, onPageChange, page],
  );

  useEffect(() => {
    if (!selectedPage || selectedPage === page || selectedPage > geometries.length) return;
    const frame = window.requestAnimationFrame(() => {
      if (followSelectedPage) goTo(selectedPage);
      else activatePage(selectedPage);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedPage, page, geometries.length, goTo, activatePage, followSelectedPage]);
  const reload = useCallback(() => {
    pageNodes.current.clear();
    observed.current.clear();
    setVisiblePages([]);
    setPage(1);
    onPageChange?.(1);
    setRevision((value) => value + 1);
  }, [onPageChange]);

  const visiblePageNumbers = useMemo(() => {
    const valid = visiblePages.filter(
      (pageNumber) => pageNumber >= 1 && pageNumber <= geometries.length,
    );
    return valid.length ? valid : [page];
  }, [geometries.length, page, visiblePages]);

  return {
    document,
    error: currentLoad?.error,
    geometries,
    page,
    pages: geometries.length,
    revision,
    viewport,
    setViewport: setViewportNode,
    setPageNode,
    visiblePageNumbers,
    onViewportScroll,
    goTo,
    activatePage,
    reload,
  };
}
