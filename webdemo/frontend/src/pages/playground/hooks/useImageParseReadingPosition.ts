import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  captureImageParseReadingAnchor,
  resolveImageParseReadingTop,
  type ImageParseReadingAnchor,
} from '../utils/imageParseReadingAnchor';

interface ImageParseReadingPositionOptions {
  /** 当前页或当前结果身份；换页、换文件时重新捕获，不做跨文档跳动。 */
  resultKey: string;
  /** 只改变展示内容、需要保持阅读位置的开关，例如页眉页脚。 */
  preserveKey: unknown;
  /** 使用结果栏已有的程序化滚动入口，避免联动把原文栏一起改写。 */
  scrollTo?: (top: number) => void;
}

/**
 * 在内容开关切换前后保持结果栏阅读位置。
 * 捕获与恢复都在布局阶段完成，避免先绘制跳位后的内容再滚动。
 */
export function useImageParseReadingPosition({
  resultKey,
  preserveKey,
  scrollTo,
}: ImageParseReadingPositionOptions) {
  const [viewport, setViewport] = useState<HTMLElement | null>(null);
  const anchor = useRef<ImageParseReadingAnchor | undefined>(undefined);
  const previousViewport = useRef<HTMLElement | null>(null);
  const previousResultKey = useRef(resultKey);
  const previousPreserveKey = useRef(preserveKey);
  const pendingCapture = useRef<number | undefined>(undefined);
  const viewportRef = useCallback((node: HTMLElement | null) => setViewport(node), []);

  const capture = useCallback(() => {
    if (!viewport) return;
    const next = captureImageParseReadingAnchor(viewport);
    // 标签隐藏时视口高度为 0；保留上一次可见时的定位点。
    if (next) anchor.current = next;
  }, [viewport]);

  useEffect(() => {
    if (!viewport) return;
    capture();
    const onScroll = () => {
      if (pendingCapture.current !== undefined) return;
      pendingCapture.current = requestAnimationFrame(() => {
        pendingCapture.current = undefined;
        capture();
      });
    };
    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      viewport.removeEventListener('scroll', onScroll);
      if (pendingCapture.current !== undefined) cancelAnimationFrame(pendingCapture.current);
      pendingCapture.current = undefined;
    };
  }, [capture, viewport]);

  useLayoutEffect(() => {
    if (!viewport) return;
    if (previousViewport.current !== viewport) {
      previousViewport.current = viewport;
      previousResultKey.current = resultKey;
      previousPreserveKey.current = preserveKey;
      anchor.current = undefined;
      capture();
      return;
    }
    if (previousResultKey.current !== resultKey) {
      previousResultKey.current = resultKey;
      previousPreserveKey.current = preserveKey;
      anchor.current = undefined;
      capture();
      return;
    }
    if (previousPreserveKey.current !== preserveKey) {
      previousPreserveKey.current = preserveKey;
      const previous = anchor.current;
      if (previous) {
        const top = resolveImageParseReadingTop(viewport, previous);
        if (top !== undefined) {
          if (scrollTo) scrollTo(top);
          else viewport.scrollTo({ top, behavior: 'instant' });
        }
        capture();
      }
      return;
    }
    if (!anchor.current) capture();
  }, [capture, preserveKey, resultKey, scrollTo, viewport]);

  return { viewportRef };
}
