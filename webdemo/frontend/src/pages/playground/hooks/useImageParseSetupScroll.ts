import { useEffect, type RefObject } from 'react';

/**
 * When a narrow-screen vertical workspace opens field configuration, bring the configuration panel into view.
 * @param visible whether field configuration is already shown
 * @param containerRef workspace scroll container
 * @param paneRef panel that contains the field configuration
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
