/**
 * 消息流自动吸底 hook。
 *
 * 用途：流式增量到来时把滚动容器自动滚到底部；但用户主动上滚阅读历史时停止吸底，
 * 直到用户重新滚回底部。避免高频 setState 下打断阅读。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react';

/** 距底部多少像素内视为「贴底」 */
const STICK_THRESHOLD = 48;
/** 一次滚轮/触摸手势会连发多帧 scroll，这段时间内都算同一次用户滚动 */
const USER_SCROLL_INTENT_MS = 180;
/**
 * 用户点击后多久内不因内容高度变化吸底。
 *
 * 要盖住「点开思考过程」这一下的全部形变：折叠面板的 grid 过渡 220ms，里面的过程滚动区
 * 还有一段 max-height 300ms，两者不同时起止。取 600ms 留余量。
 */
const INTERACTION_HOLD_MS = 600;
const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp', ' ']);

/**
 * @param updateKey 触发吸底的内容更新标识
 * @param turnKey 新一轮对话标识；变化时恢复自动跟随并立即滚到底部
 * @returns 滚动容器 ref、内容 ref 与滚动事件处理器
 */
export function useAutoScroll(updateKey: unknown, turnKey: unknown) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [userScrollPendingRef, markUserScrollIntent] = useExpiringFlag(USER_SCROLL_INTENT_MS);
  const [interactionHoldRef, markInteraction] = useExpiringFlag(INTERACTION_HOLD_MS);

  const scrollToBottom = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, []);

  // 只有明确的滚轮、触摸或键盘输入才改变跟随状态，忽略布局变化引发的 scroll。
  const onScroll = useCallback(() => {
    if (!userScrollPendingRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickRef.current = distance <= STICK_THRESHOLD;
  }, [userScrollPendingRef]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (SCROLL_KEYS.has(event.key)) markUserScrollIntent();
    },
    [markUserScrollIntent],
  );

  // 用户发起新一轮对话时，无论此前是否上滚，都应立即回到最新消息。
  useLayoutEffect(() => {
    stickRef.current = true;
    scrollToBottom();
  }, [scrollToBottom, turnKey]);

  // 流式增量或工具状态更新后，在浏览器绘制前保持吸底。
  useLayoutEffect(() => {
    if (!stickRef.current) return;
    scrollToBottom();
  }, [scrollToBottom, updateKey]);

  // Markdown、表格、引用和折叠内容可能在提交后继续改变高度，需监听真实内容尺寸。
  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      if (!stickRef.current) return;
      /*
        用户刚点过：这一次高度变化是他自己按出来的（展开思考过程、切换回答版本、展开长表格），
        吸底会把刚点的那一行连同它上方的内容一起顶出视口顶部——「点开」的预期是内容向下长
        出来，而不是页面往上蹿。流式增量不走这条路（由 updateKey 的 layout effect 吸底），
        所以押住这里不会让跟随输出变迟钝。
      */
      if (interactionHoldRef.current) return;
      scrollToBottom();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [interactionHoldRef, scrollToBottom]);

  return {
    scrollRef,
    contentRef,
    onScroll,
    onWheel: markUserScrollIntent,
    onTouchMove: markUserScrollIntent,
    onKeyDown,
    onPointerDown: markInteraction,
  };
}

/**
 * 一个到点自动失效的布尔标记。
 *
 * 两处用途（识别用户滚动手势、押住点击引发的重排）都要「标一下、过一会儿自己清掉」，
 * 且都必须存 ref 不能存 state：它们在 layout effect 与 ResizeObserver 回调里读，
 * 改成 state 会因重渲染把 observer 整个重建。
 *
 * @param durationMs 标记有效时长
 * @returns [标记 ref, 打标记函数]
 */
function useExpiringFlag(durationMs: number) {
  const activeRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const mark = useCallback(() => {
    activeRef.current = true;
    if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      activeRef.current = false;
      timerRef.current = undefined;
    }, durationMs);
  }, [durationMs]);

  useEffect(
    () => () => {
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    },
    [],
  );

  return [activeRef, mark] as const;
}
