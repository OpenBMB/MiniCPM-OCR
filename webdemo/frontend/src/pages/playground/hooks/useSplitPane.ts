/**
 * 左右对照分栏拖拽。
 *
 * 用途：对照阅读时，原图和结果谁该占更多宽度取决于图本身——竖排表格想给原图多点，
 * 通篇文字想给 Markdown 多点。固定 50/50 是替用户做了决定。
 *
 * 拖拽用 Pointer Events + setPointerCapture：一次捕获到底，
 * 指针划出分隔条甚至划出窗口都不会丢事件，不必在 window 上挂全局监听再记得摘掉。
 *
 * 按下时记录指针、比例与容器宽度，移动按位移换算，避免从透明抓取区边缘按下时跳动。
 */

import { useCallback, useRef, useState } from 'react';

/** 左栏占比上下限，避免任一侧被拖到不可用。 */
const MIN_RATIO = 24;
const MAX_RATIO = 76;
/** 键盘每次调整的步长。 */
const KEY_STEP = 2;
/** 容器标记属性，分隔条靠它反查自己该按谁的宽度换算。 */
const CONTAINER_ATTR = 'data-split-container';

/** 分栏控制。 */
export interface SplitPane {
  /** 左栏占比（百分数） */
  ratio: number;
  /** 是否正在拖拽。拖拽期间必须关掉分栏宽度过渡，否则栏宽会慢指针一步 */
  dragging: boolean;
  /** 摊到分栏容器上，让分隔条能找到它 */
  containerProps: Record<string, string>;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  /** 双击分隔条回到均分 */
  reset: () => void;
  min: number;
  max: number;
}

function clamp(value: number): number {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, value));
}

/**
 * 可拖拽分栏。
 * @param initial 左栏初始占比，默认均分
 */
export function useSplitPane(initial = 50): SplitPane {
  const [ratio, setRatio] = useState(clamp(initial));
  const [dragging, setDragging] = useState(false);
  // 事件间同步保存拖拽快照，避免状态更新延迟或第二根手指改变本次拖拽。
  const dragRef = useRef<{
    pointerId: number;
    clientX: number;
    ratio: number;
    width: number;
  } | null>(null);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || dragRef.current) return;
    const target = event.currentTarget;
    const containerRect = target
      .closest<HTMLElement>(`[${CONTAINER_ATTR}]`)
      ?.getBoundingClientRect();
    const dividerRect = target.getBoundingClientRect();
    const width = containerRect?.width ?? 0;
    if (!containerRect || width <= 0) return;
    // 负边距让分隔条右边缘贴合原图栏边界，按当前布局接续未结束的调宽过渡。
    const ratio = clamp(
      ((dividerRect.left + dividerRect.width - containerRect.left) / width) * 100,
    );
    target.setPointerCapture(event.pointerId);
    target.focus({ preventScroll: true });
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, ratio, width };
    setRatio(ratio);
    setDragging(true);
    event.preventDefault();
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    setRatio(clamp(drag.ratio + ((event.clientX - drag.clientX) / drag.width) * 100));
  }, []);

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current || event.pointerId !== dragRef.current.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowLeft') setRatio((current) => clamp(current - KEY_STEP));
    else if (event.key === 'ArrowRight') setRatio((current) => clamp(current + KEY_STEP));
    else if (event.key === 'Home') setRatio(MIN_RATIO);
    else if (event.key === 'End') setRatio(MAX_RATIO);
    else return;
    event.preventDefault();
  }, []);

  const reset = useCallback(() => setRatio(50), []);

  return {
    ratio,
    dragging,
    containerProps: { [CONTAINER_ATTR]: '' },
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onKeyDown,
    reset,
    min: MIN_RATIO,
    max: MAX_RATIO,
  };
}
