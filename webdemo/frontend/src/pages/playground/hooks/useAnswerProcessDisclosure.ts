/**
 * 回答过程折叠区的展开与滚动跟随状态。
 *
 * 用途：把「什么时候自动展开」「滚动要不要跟着输出走」这两件纯交互的事从视图里抽出来。
 * 自动展开有两个来源（流式期间首次出现过程内容、失败态首次出现），两者共用同一个
 * 「用户手动操作过就不再抢占」的闸门。
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type UIEvent } from 'react';

/** 判定"仍贴着底部"的容差：差这点距离不算用户主动往回翻。 */
const STICK_THRESHOLD_PX = 32;

interface UseAnswerProcessDisclosureInput {
  /** 是否仍在流式生成。 */
  streaming: boolean;
  /** 流式期间是否已出现可展示的过程内容（思考文本或工具活动）。 */
  hasProcess: boolean;
  /** 是否有工具失败或被中断。 */
  failed: boolean;
}

/** 过程滚动区的跟随控制：一个引用稳定的对象，可直接进 effect 依赖。 */
export interface ProcessFollow {
  /**
   * 此刻是否应该把滚动区贴回底部。
   *
   * 必须在 effect 里调用、不要在渲染期取值：跟随开关与「是否仍贴着底」都存在 ref 里，
   * 渲染期读既拿不到本帧最新值，也会让每个读取点各自快照出一份不一致的状态。
   */
  shouldFollow: () => boolean;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  onWheel: () => void;
  onTouchMove: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

interface UseAnswerProcessDisclosureResult {
  expanded: boolean;
  toggle: () => void;
  /** 滚动跟随控制，连同摊给滚动容器的事件处理器。 */
  follow: ProcessFollow;
}

/** 会被视为"用户想自己滚"的按键。 */
const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp', ' ']);

/**
 * 管理过程折叠区的展开状态与滚动跟随。
 * @param input 流式状态、是否已有过程内容、是否失败
 * @returns 展开态、切换函数与滚动区所需的跟随控制
 */
export function useAnswerProcessDisclosure({
  streaming,
  hasProcess,
  failed,
}: UseAnswerProcessDisclosureInput): UseAnswerProcessDisclosureResult {
  const [expanded, setExpanded] = useState((streaming || failed) && hasProcess);
  const stickRef = useRef(true);
  const scrollIntentRef = useRef(false);
  const followRef = useRef(streaming && hasProcess);
  // 唯一的"别再抢占"闸门：两条自动展开路径都读它，用户手动收起后谁都不许再打开
  const manuallyToggledRef = useRef(false);
  const autoOpenedRef = useRef(streaming && hasProcess);
  const previousStreamingRef = useRef(streaming);
  const previousFailedRef = useRef(failed);

  // 新一轮流式开始：把上一轮攒下的跟随状态与闸门全部复位
  useEffect(() => {
    const phaseChanged = previousStreamingRef.current !== streaming;
    previousStreamingRef.current = streaming;
    if (!(phaseChanged && streaming)) return;

    autoOpenedRef.current = false;
    followRef.current = true;
    stickRef.current = true;
    manuallyToggledRef.current = false;
  }, [streaming]);

  // 流式期间首次出现过程内容时自动展开一次
  useEffect(() => {
    if (!streaming) {
      autoOpenedRef.current = false;
      // 输出结束就交还滚动位置：之后任何高度变化（切换回答版本、图片加载完）都不该
      // 再把过程区拽回底部，否则用户刚翻到的那一段会被抢走。
      followRef.current = false;
      return;
    }
    if (!hasProcess || autoOpenedRef.current) return;

    autoOpenedRef.current = true;
    followRef.current = true;
    stickRef.current = true;
    if (manuallyToggledRef.current) return;
    // 延到下一个宏任务再展开：首段内容与展开动画同帧触发时，grid-template-rows 过渡
    // 会从"内容已经撑满"的状态起步，看上去像是直接跳出来而不是展开
    const timer = setTimeout(() => setExpanded(true), 0);
    return () => clearTimeout(timer);
  }, [hasProcess, streaming]);

  // 失败态首次出现时自动展开，让用户不必多点一次就能看到失败在哪一步
  useEffect(() => {
    const justFailed = !previousFailedRef.current && failed;
    previousFailedRef.current = failed;
    if (justFailed && !manuallyToggledRef.current) setExpanded(true);
  }, [failed]);

  /*
    整个跟随控制收进一个空依赖的 useMemo：ref 本身引用稳定，所以空依赖是成立的，
    而对象引用稳定才能安全地进滚动区 layout effect 的依赖数组——每渲染新建一个对象，
    那个 effect 就会每帧重跑一次，把用户往回翻的滚动位置一并抢走。
  */
  const follow = useMemo<ProcessFollow>(
    () => ({
      shouldFollow: () => followRef.current && stickRef.current,
      onScroll: (event) => {
        // 只认由 wheel/touch/按键触发的滚动：自动跟随自己写 scrollTop 也会触发 onScroll，
        // 不加这道闸门会被自己的跟随动作误判成"用户往回翻了"，跟随立刻失效
        if (!scrollIntentRef.current) return;
        const element = event.currentTarget;
        const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
        stickRef.current = distance <= STICK_THRESHOLD_PX;
        scrollIntentRef.current = false;
      },
      onWheel: () => {
        scrollIntentRef.current = true;
      },
      onTouchMove: () => {
        scrollIntentRef.current = true;
      },
      onKeyDown: (event) => {
        if (SCROLL_KEYS.has(event.key)) scrollIntentRef.current = true;
      },
    }),
    [],
  );

  return {
    expanded,
    toggle: () => {
      manuallyToggledRef.current = true;
      setExpanded((value) => !value);
    },
    follow,
  };
}
