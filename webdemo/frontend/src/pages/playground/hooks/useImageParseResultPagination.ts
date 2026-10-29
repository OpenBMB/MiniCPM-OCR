import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/** PDF 页码状态与结果身份，用于在现有单页结果栏中接续阅读。 */
export interface ImageParseResultPaginationOptions {
  pdf?: { page: number; pages: number; setPage: (page: number) => void };
  resultKeyForPage: (page?: number) => string;
  markdown: string;
}

type PageEntry = { key: string; previousKey: string; edge: 0 | 1 };
const GESTURE_IDLE_MS = 160;
const PAGE_TURN_INTERVAL_MS = 320;

/**
 * 当前页预览到达边界后翻页；正文滚动、编辑和缩放继续使用原生交互。
 * @param resultKey 当前结果身份
 * @param options PDF 页码与结果身份
 * @param onEnter 新页挂载后定位到页首或页尾
 * @returns 结果栏根节点 ref，空页和失败页也可接收翻页手势
 */
export function useImageParseResultPagination(
  resultKey: string,
  options: ImageParseResultPaginationOptions | undefined,
  onEnter: (edge: 0 | 1) => boolean,
) {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const entry = useRef<PageEntry | undefined>(undefined);
  const lastWheel = useRef(-Infinity);
  const lastTurn = useRef(-Infinity);
  const gestureLocked = useRef(false);
  const pdf = options?.pdf;
  const page = pdf?.page;
  const pages = pdf?.pages;
  const setPage = pdf?.setPage;
  const pageKey = options?.resultKeyForPage;
  const markdown = options?.markdown;
  const resultPaneRef = useCallback((node: HTMLElement | null) => setRoot(node), []);

  useLayoutEffect(() => {
    if (!root || !page || !pages || !setPage || !pageKey) return;
    const onWheel = (event: WheelEvent) => {
      if (
        root.dataset.ocrResultTab !== 'preview' ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        !event.deltaY ||
        Math.abs(event.deltaX) >= Math.abs(event.deltaY)
      )
        return;
      const target = event.target;
      if (
        target instanceof Element &&
        (target.closest(
          '[data-visual-editing="true"], input, textarea, select, [contenteditable="true"]',
        ) ||
          root.querySelector('[data-visual-editing="true"]'))
      )
        return;
      const viewport = root.querySelector<HTMLElement>('[data-ocr-result-scroll]');
      if (viewport && (!(target instanceof Node) || !viewport.contains(target))) return;
      // 嵌套表格/代码滚动区域不应该触发整页切换。
      if (target instanceof HTMLElement) {
        for (
          let node: HTMLElement | null = target;
          node && node !== viewport && node !== root;
          node = node.parentElement
        ) {
          if (
            node.scrollHeight > node.clientHeight + 1 &&
            /auto|scroll/.test(getComputedStyle(node).overflowY)
          )
            return;
        }
      }
      const now = Date.now();
      if (
        now - lastWheel.current > GESTURE_IDLE_MS &&
        now - lastTurn.current >= PAGE_TURN_INTERVAL_MS
      )
        gestureLocked.current = false;
      lastWheel.current = now;
      if (
        entry.current &&
        entry.current.key !== resultKey &&
        entry.current.previousKey === resultKey
      ) {
        event.preventDefault();
        return;
      }
      const range = viewport ? Math.max(0, viewport.scrollHeight - viewport.clientHeight) : 0;
      const top = viewport?.scrollTop ?? 0;
      const direction = event.deltaY > 0 ? 1 : -1;
      if ((direction > 0 && range - top > 1) || (direction < 0 && top > 1)) return;
      const next = page + direction;
      if (next < 1 || next > pages) return;
      event.preventDefault();
      // 一次触控板惯性手势只跨一页，短页也不会连续跳到文档末尾。
      if (gestureLocked.current) return;
      entry.current = { key: pageKey(next), previousKey: resultKey, edge: direction > 0 ? 0 : 1 };
      gestureLocked.current = true;
      lastTurn.current = now;
      setPage(next);
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, [root, page, pages, setPage, pageKey, resultKey]);

  useLayoutEffect(() => {
    const pending = entry.current;
    if (!root || !pending) return;
    if (pending.key !== resultKey) {
      if (pending.previousKey !== resultKey) entry.current = undefined;
      return;
    }
    // 左侧页码定位在下一帧提交，再恢复右侧入口，避免旧页确认覆盖新页底部。
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (entry.current === pending && onEnter(pending.edge)) entry.current = undefined;
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [root, resultKey, markdown, onEnter]);

  return resultPaneRef;
}
