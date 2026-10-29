/**
 * Hook that sticks the message stream to the bottom automatically.
 *
 * Purpose: when a streaming increment arrives, scroll the container to the bottom; but when the user scrolls up to read history, stop sticking,
 * until the user scrolls back to the bottom. Avoid interrupting reading under high-frequency setState.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react';

/** Within how many pixels of the bottom counts as "stuck to the bottom" */
const STICK_THRESHOLD = 48;
/** One wheel or touch gesture fires several frames of scroll; that whole interval counts as one user scroll */
const USER_SCROLL_INTENT_MS = 180;
/**
 * How long after a user click a content-height change must not stick to the bottom.
 *
 * It has to cover the whole deformation of "opening the reasoning process": the disclosure's grid transition is 220ms, and the process scroll area inside
 * has another max-height of 300ms, and the two do not start and end together. 600ms leaves a margin.
 */
const INTERACTION_HOLD_MS = 600;
const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp', ' ']);

/**
 * @param updateKey content-update id that triggers sticking to the bottom
 * @param turnKey id of a new conversation turn; when it changes, restore automatic follow and scroll to the bottom immediately
 * @returns scroll-container ref, content ref, and the scroll event handler
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

  // Only an explicit wheel, touch, or keyboard input changes follow state; ignore scroll caused by a layout change.
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

  // When the user starts a new turn, return to the latest message immediately, whether or not they had scrolled up.
  useLayoutEffect(() => {
    stickRef.current = true;
    scrollToBottom();
  }, [scrollToBottom, turnKey]);

  // After a streaming increment or a tool-status update, stay stuck to the bottom before the browser paints.
  useLayoutEffect(() => {
    if (!stickRef.current) return;
    scrollToBottom();
  }, [scrollToBottom, updateKey]);

  // Markdown, tables, citations, and disclosure content may keep changing height after commit, so the real content size has to be observed.
  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      if (!stickRef.current) return;
      /*
        The user just clicked: this height change is one they pressed themselves (expanding reasoning, switching an answer version, expanding a long table).
        Sticking to the bottom would push the row just clicked, together with the content above it, off the top of the viewport — the expectation of "opening" is that content grows
        downward, not that the page jumps upward. Streaming increments do not take this path (updateKey's layout effect sticks to the bottom),
        so holding here does not make following the output feel sluggish.
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
 * A boolean flag that clears itself when its time is up.
 *
 * Both uses (recognizing a user scroll gesture, and holding back a reflow caused by a click) need "mark it, then clear it after a while",
 * and both must live in a ref rather than state: they are read inside a layout effect and a ResizeObserver callback,
 * and turning them into state would rebuild the whole observer on re-render.
 *
 * @param durationMs how long the flag stays valid
 * @returns [flag ref, function that sets the flag]
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
