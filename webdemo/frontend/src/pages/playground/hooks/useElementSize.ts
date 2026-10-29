/**
 * 观测元素的布局尺寸。
 *
 * 用途：图片视口与内容都要按实际尺寸算缩放贴合与平移边界，而这两个盒子会随
 * 分栏拖拽、窗口缩放、侧栏展开而变——只在挂载时量一次就会算错。
 *
 * 用 ResizeObserver 而不是监听 window.resize：报的是布局盒，
 * transform 不影响它，所以缩放过程中不会自激成死循环。
 */

import { useEffect, useState } from 'react';

/** 元素布局尺寸；宽为 0 表示还没测量到。 */
export interface ElementSize {
  width: number;
  height: number;
}

const EMPTY: ElementSize = { width: 0, height: 0 };

/**
 * 跟随元素尺寸变化。
 * @param node 目标元素，null 时返回零尺寸
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
