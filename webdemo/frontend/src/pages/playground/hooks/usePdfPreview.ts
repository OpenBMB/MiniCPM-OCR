import { useEffect, useMemo, useState } from 'react';
import { useElementSize } from './useElementSize';
import { usePdfPageRenderer } from './usePdfPageRenderer';
import { usePdfPreviewPages } from './usePdfPreviewPages';
import { usePdfPreviewPan } from './usePdfPreviewPan';
import { usePdfPreviewZoom } from './usePdfPreviewZoom';
import type { PdfPageView } from '../utils/pdfPreviewRender';
import { isImageParseSharedPdfUrl } from '../utils/imageParseExamples';

/** 滚轮停止后的高清重绘等待时长，先用 CSS 缩放保持交互跟手。 */
const PDF_ZOOM_RENDER_DELAY_MS = 150;

/**
 * 编排 PDF.js 连续阅读生命周期；只渲染视口附近页面，避免大 PDF 一次性占满内存。
 * @param source PDF 地址或 data URL
 * @param selectedPage 外部要求定位的页码
 * @param onPageChange 当前页变化回调
 * @returns 页面骨架、当前页、渲染状态与缩放旋转操作
 */
export function usePdfPreview(
  source: string,
  selectedPage?: number,
  onPageChange?: (page: number) => void,
  followSelectedPage = true,
) {
  const pages = usePdfPreviewPages(source, selectedPage, onPageChange, followSelectedPage);
  const pan = usePdfPreviewPan(Boolean(pages.document));
  const size = useElementSize(pages.viewport);
  const {
    scale,
    zoomIn,
    zoomOut,
    reset: resetZoom,
  } = usePdfPreviewZoom(pages.viewport, Boolean(pages.document));
  const [rotation, setRotation] = useState(0);
  const [renderScale, setRenderScale] = useState(1);
  const pageList = useMemo<PdfPageView[]>(
    () =>
      pages.geometries.map((geometry) => {
        const pageRotation = (geometry.rotation + rotation) % 360;
        const swapped = pageRotation % 180 !== 0;
        const width = swapped ? geometry.height : geometry.width;
        const height = swapped ? geometry.width : geometry.height;
        const fit = Math.min(Math.max(size.width - 32, 0) / width, 1.5);
        const displayScale = Math.max(0.1, fit);
        return {
          ...geometry,
          rotation: pageRotation,
          baseWidth: width * displayScale,
          baseHeight: height * displayScale,
        };
      }),
    [pages.geometries, rotation, size.width],
  );

  useEffect(() => {
    if (scale === renderScale) return;
    const timer = window.setTimeout(() => setRenderScale(scale), PDF_ZOOM_RENDER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [renderScale, scale]);
  const rendered = usePdfPageRenderer({
    document: pages.document,
    revision: pages.revision,
    geometries: pages.geometries,
    visiblePageNumbers: pages.visiblePageNumbers,
    currentPage: pages.page,
    viewportWidth: size.width,
    scale: renderScale,
    rotation,
    loadError: pages.error,
    cache: isImageParseSharedPdfUrl(source),
  });

  return {
    document: pages.document,
    page: pages.page,
    pages: pages.pages,
    pageList,
    visiblePageNumbers: pages.visiblePageNumbers,
    scale,
    renderScale,
    rotation,
    ...rendered,
    ...pan,
    setViewport: pages.setViewport,
    setPageNode: pages.setPageNode,
    onViewportScroll: pages.onViewportScroll,
    goTo: pages.goTo,
    activatePage: pages.activatePage,
    zoomIn,
    zoomOut,
    rotate: () => setRotation((value) => (value + 90) % 360),
    reset: () => {
      resetZoom();
      setRotation(0);
    },
    retry: () => {
      resetZoom();
      setRotation(0);
      rendered.reset();
      pages.reload();
    },
  };
}
