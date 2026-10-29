/**
 * Observe an element's layout size.
 *
 * Purpose: both the image viewport and the content need their real size to compute zoom fit and pan bounds, and those two boxes change with
 * split dragging, window resize, and the sidebar opening — measuring once on mount would compute the wrong value.
 *
 * Use ResizeObserver rather than listening to window.resize: it reports the layout box,
 * and transform does not affect it, so zooming does not excite itself into a dead loop.
 */

import { useEffect, useState } from 'react';

/** Element layout size; width 0 means it has not been measured yet. */
export interface ElementSize {
  width: number;
  height: number;
}

const EMPTY: ElementSize = { width: 0, height: 0 };

/**
 * Follow changes in an element's size.
 * @param node target element; return a zero size when null
 */
export function useElementSize(node: HTMLElement | null): ElementSize {
  const [size, setSize] = useState<ElementSize>(EMPTY);

  useEffect(() => {
    if (!node) return undefined;
    function measure() {
      const { clientWidth: width, clientHeight: height } = node as HTMLElement;
      setSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return size;
}
