import { useEffect, type RefObject } from 'react';

/**
 * 窄屏纵向工作区打开字段配置时，将配置面板带入可见区域。
 * @param visible 是否已显示字段配置
 * @param containerRef 工作区滚动容器
 * @param paneRef 字段配置所在面板
 */
export function useImageParseSetupScroll(
  visible: boolean,
  containerRef: RefObject<HTMLDivElement | null>,
  paneRef: RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    if (!visible || window.matchMedia?.('(min-width: 1024px)').matches) return;
    const frame = window.requestAnimationFrame(() => {
      const container = containerRef.current;
      const pane = paneRef.current;
      if (!container || !pane) return;
      const top =
        pane.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop;
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      container.scrollTo({ top, behavior: reducedMotion ? 'auto' : 'smooth' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [containerRef, paneRef, visible]);
}
