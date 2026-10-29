import type { Driver } from 'driver.js';

/**
 * Track target geometry during the tour, so the mask and popover stay aligned after loading, wrapping, and container scroll.
 * @param instance current tour instance
 * @returns entry that cancels detection on step change, close, or unmount
 */
export function trackImageParseTourLayout(
  instance: Pick<Driver, 'isActive' | 'getActiveElement' | 'refresh'>,
): () => void {
  instance.refresh();
  const element = instance.getActiveElement();
  if (!element || element.id === 'driver-dummy-element') return () => {};
  let previous = element.getBoundingClientRect();
  let stopped = false;
  let frame: number;
  const check = () => {
    if (
      stopped ||
      !instance.isActive() ||
      !element.isConnected ||
      instance.getActiveElement() !== element
    )
      return;
    // ResizeObserver does not notice a position change at the same size; each frame reads only the current target, and redraws only when it changes.
    const rect = element.getBoundingClientRect();
    if (
      rect.x !== previous.x ||
      rect.y !== previous.y ||
      rect.width !== previous.width ||
      rect.height !== previous.height
    ) {
      previous = rect;
      instance.refresh();
    }
    frame = window.requestAnimationFrame(check);
  };
  frame = window.requestAnimationFrame(check);
  return () => {
    stopped = true;
    window.cancelAnimationFrame(frame);
  };
}
