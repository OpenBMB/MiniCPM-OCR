/**
 * Expand state and scroll-follow state for the answer-process disclosure.
 *
 * Purpose: pull the two purely interactive questions "when to expand automatically" and "whether scroll should follow the output" out of the view.
 * Automatic expand has two sources (process content appearing for the first time while streaming, and the failure state appearing for the first time), and they share one
 * gate: once the user has operated it manually, neither may take over again.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type UIEvent } from 'react';

/** Tolerance for judging "still stuck to the bottom": a gap this small does not count as the user scrolling back on purpose. */
const STICK_THRESHOLD_PX = 32;

interface UseAnswerProcessDisclosureInput {
  /** Whether generation is still streaming. */
  streaming: boolean;
  /** Whether displayable process content (reasoning text or tool activity) has appeared during streaming. */
  hasProcess: boolean;
  /** Whether a tool failed or was interrupted. */
  failed: boolean;
}

/** Follow control for the process scroll area: one referentially stable object that can go straight into an effect dependency. */
export interface ProcessFollow {
  /**
   * Whether the scroll area should be stuck back to the bottom right now.
   *
   * Call this inside an effect, and do not read it during render: both the follow switch and "still stuck to the bottom" live in refs.
   * A render-time read neither sees this frame's latest value, nor avoids each read site snapshotting its own inconsistent state.
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
  /** Scroll-follow control, together with the event handlers spread onto the scroll container. */
  follow: ProcessFollow;
}

/** Keys treated as "the user wants to scroll themselves". */
const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp', ' ']);

/**
 * Manage expand state and scroll follow for the process disclosure.
 * @param input streaming state, whether process content already exists, and whether it failed
 * @returns the expanded state, the toggle function, and the follow control the scroll area needs
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
  // The only "do not take over again" gate: both automatic-expand paths read it, and after the user collapses it manually neither may open it again
  const manuallyToggledRef = useRef(false);
  const autoOpenedRef = useRef(streaming && hasProcess);
  const previousStreamingRef = useRef(streaming);
  const previousFailedRef = useRef(failed);

  // A new streaming turn starts: reset all of the follow state and the gate accumulated in the previous turn
  useEffect(() => {
    const phaseChanged = previousStreamingRef.current !== streaming;
    previousStreamingRef.current = streaming;
    if (!(phaseChanged && streaming)) return;

    autoOpenedRef.current = false;
    followRef.current = true;
    stickRef.current = true;
    manuallyToggledRef.current = false;
  }, [streaming]);

  // Expand once automatically when process content appears for the first time during streaming
  useEffect(() => {
    if (!streaming) {
      autoOpenedRef.current = false;
      // When output ends, give the scroll position back: any later height change (switching answer versions, an image finishing load) must not
      // pull the process area back to the bottom, or the passage the user just scrolled to would be taken away.
      followRef.current = false;
      return;
    }
    if (!hasProcess || autoOpenedRef.current) return;

    autoOpenedRef.current = true;
    followRef.current = true;
    stickRef.current = true;
    if (manuallyToggledRef.current) return;
    // Expand on the next macrotask: when the first content and the expand animation fire in the same frame, the grid-template-rows transition
    // starts from a state where the content is already full, and it looks like it jumped out instead of expanding
    const timer = setTimeout(() => setExpanded(true), 0);
    return () => clearTimeout(timer);
  }, [hasProcess, streaming]);

  // Expand automatically the first time the failure state appears, so the user can see which step failed without an extra click
  useEffect(() => {
    const justFailed = !previousFailedRef.current && failed;
    previousFailedRef.current = failed;
    if (justFailed && !manuallyToggledRef.current) setExpanded(true);
  }, [failed]);

  /*
    The whole follow control is kept in a useMemo with an empty dependency list: the ref itself is referentially stable, so the empty list is valid,
    and a stable object reference is what can safely enter the dependency array of the scroll area's layout effect — a new object on every render
    would rerun that effect every frame and take away the scroll position the user had moved back to.
  */
  const follow = useMemo<ProcessFollow>(
    () => ({
      shouldFollow: () => followRef.current && stickRef.current,
      onScroll: (event) => {
        // Count only scroll caused by wheel, touch, or keys: follow writing scrollTop itself also fires onScroll,
        // and without this gate its own follow action would be mistaken for "the user scrolled back", and follow would stop immediately
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
