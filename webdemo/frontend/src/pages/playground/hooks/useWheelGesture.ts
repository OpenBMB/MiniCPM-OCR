/**
 * 滚轮手势采集。
 *
 * 用途：图片缩放要跟着滚轮走，但原生滚轮事件直接接会有两个坑：
 * 1. React 把根上的 wheel 注册为 passive，合成事件里 preventDefault 拦不住页面滚动，
 *    必须自己以非 passive 方式挂原生监听；
 * 2. 一次滚动能打出上百个事件，逐个 setState 会让大图掉帧——所以按
 *    requestAnimationFrame 合帧，累计增量每帧只应用一次。
 *
 * 另外把「正在滚」暴露出去：连续手势期间调用方应关掉 CSS 过渡才跟手。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** 行模式滚轮（Firefox）一格 deltaY 只有 ±3，按行高折算成像素才有同样手感。 */
const LINE_HEIGHT = 16;
/** 滚动停止多久后认为手势结束。 */
const SETTLE_MS = 140;

/**
 * 把元素上的滚轮接成合帧后的增量回调。
 * @param node 目标元素，null 时不监听
 * @param onDelta 每帧回调一次，delta 是累计的像素增量，event 是该帧最后一个事件
 * @returns gesturing 是否正在连续滚动
 */
export function useWheelGesture(
  node: HTMLElement | null,
  onDelta: (delta: number, event: WheelEvent) => void,
): { gesturing: boolean } {
  const [gesturing, setGesturing] = useState(false);
  const handlerRef = useRef(onDelta);
  const pendingRef = useRef<{ delta: number; event: WheelEvent } | null>(null);
  const frameRef = useRef(0);
  const settleRef = useRef(0);

  useEffect(() => {
    handlerRef.current = onDelta;
  }, [onDelta]);

  const flush = useCallback(() => {
    frameRef.current = 0;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) handlerRef.current(pending.delta, pending.event);
  }, []);

  useEffect(() => {
    if (!node) return undefined;
    function listener(event: WheelEvent) {
      event.preventDefault();
      const delta = event.deltaMode === 1 ? event.deltaY * LINE_HEIGHT : event.deltaY;
      pendingRef.current = { delta: (pendingRef.current?.delta ?? 0) + delta, event };
      setGesturing(true);
      window.clearTimeout(settleRef.current);
      settleRef.current = window.setTimeout(() => setGesturing(false), SETTLE_MS);
      if (!frameRef.current) frameRef.current = window.requestAnimationFrame(flush);
    }
    node.addEventListener('wheel', listener, { passive: false });
    return () => {
      node.removeEventListener('wheel', listener);
      window.clearTimeout(settleRef.current);
      window.cancelAnimationFrame(frameRef.current);
    };
  }, [flush, node]);

  return { gesturing };
}
