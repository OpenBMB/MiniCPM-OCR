import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

import { Button, cn } from '@map/ui';

import type { ProcessFollow } from '../hooks/useAnswerProcessDisclosure';
import type { Citation } from '../types';
import { MarkdownRenderer } from './MarkdownRenderer';

/**
 * Renders the title row of the answer-process disclosure.
 *
 * The whole row is the disclosure toggle: the top of the process area only states how long reasoning took. Sources reach the drawer through the chip under the answer, and the title is no longer a second jump target — two actions on one row leave users unsure what a click will do.
 *
 * @param props Title, icon, expanded state, and content
 * @returns A keyboard-operable disclosure
 */
export function ProcessDisclosure({
  id,
  expanded,
  title,
  icon,
  failed = false,
  onToggle,
  children,
}: {
  id: string;
  expanded: boolean;
  title: string;
  icon: ReactNode;
  failed?: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const tone = failed
    ? 'text-destructive hover:bg-destructive/5 hover:text-destructive'
    : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground';
  const rowClassName =
    'h-auto min-h-9 items-center gap-2 rounded-md px-0 py-1.5 text-left text-sm font-normal transition-[background-color,color] duration-200';

  const head = (
    <>
      {/*
        The icon cell only aligns; it does not paint a background. Timeline markers use bg-background to punch a gap in the connector (see ProcessRailItem). The top row has no line through it, so the same fill is only a side effect: when the row hover color changes, this opaque fill cuts a round hole out of the hover color, as if the icon brought its own background.
      */}
      {/* Keep the title column width and left-align the icon with the answer body, so centering does not add extra inset. */}
      <span className="flex size-6 shrink-0 items-center justify-start">{icon}</span>
      <span className="min-w-0 truncate">{title}</span>
    </>
  );
  const chevron = (
    <ChevronDown
      className={cn(
        // The arrow rotates with expanded, using an ease-out curve matched to the max-height expand speed
        'size-4 shrink-0 transition-transform duration-[250ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
        expanded && 'rotate-180',
      )}
      aria-hidden="true"
    />
  );

  return (
    <div className="relative z-10">
      <Button
        type="button"
        variant="ghost"
        aria-controls={id}
        aria-expanded={expanded}
        data-testid="process-toggle"
        className={cn(
          'grid w-full max-w-3xl grid-cols-[1.5rem_minmax(0,1fr)_1rem]',
          rowClassName,
          tone,
        )}
        onClick={onToggle}
      >
        {head}
        {chevron}
      </Button>

      <DisclosurePanel id={id} expanded={expanded}>
        {children}
      </DisclosurePanel>
    </div>
  );
}

/**
 * Renders a process scroller that can follow output automatically.
 *
 * Scrolling has to be carried by the whole timeline: after interleaving, reasoning is split into segments, and a scrollbar on each segment neither scrolls nor shows order. The attribute name stays data-reasoning-scroll so callers (including tests) can find this scroller.
 *
 * @param props Expanded state, streaming state, content fingerprint that re-pins to the bottom, follow control, and timeline content
 * @returns The process content scroller
 */
export function ProcessScrollArea({
  expanded,
  streaming,
  watch,
  follow,
  children,
}: {
  expanded: boolean;
  streaming: boolean;
  watch: string;
  follow: ProcessFollow;
  children: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    // Ask the follow state only here: once the user has scrolled back, do not yank the scroll position to the bottom
    if (!follow.shouldFollow()) return;
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [follow, watch, streaming]);

  useLayoutEffect(() => {
    if (expanded) return;
    const element = scrollRef.current;
    if (!element) return;
    /*
      On collapse, reset the read position to zero so the next expand starts from the top.

      The collapsed state is invisible, so resetting here has no visual cost. Without it, the scrollTop that followed to the end during streaming stays put, and the next open shows the **tail** of the reasoning — content starts in the middle, as if it stopped at random. Collapsing and expanding during streaming is unaffected: the next incremental frame pins it back to the bottom.
    */
    element.scrollTop = 0;
  }, [expanded]);

  return (
    <div
      ref={scrollRef}
      data-reasoning-scroll
      onScroll={follow.onScroll}
      onWheel={follow.onWheel}
      onTouchMove={follow.onTouchMove}
      onKeyDown={follow.onKeyDown}
      className={cn(
        'max-w-2xl overflow-y-auto overscroll-contain pb-1 pr-2',
        /*
          During streaming, cap at 48 (so it does not take much of the screen); after streaming, raise it to 96. Switching directly is a hard jump: a 300px-tall process area grows from 192px to 300px in one frame and shoves the body below it down — that is the page twitch the instant an answer finishes. The transition lets it grow; running it together with the disclosure animation does not fight (the 1fr target follows the content, and there is no second animation in practice).
        */
        'transition-[max-height] duration-300 ease-out motion-reduce:transition-none',
        streaming ? 'max-h-48' : 'max-h-96',
      )}
    >
      {children}
    </div>
  );
}

/**
 * One reasoning segment on the timeline.
 *
 * Reasoning can also contain `[ref_N]` badges — the model thinks while reading search results, so citation numbers land in the reasoning. Without passing sources in, those badges neither become links nor stay text; bare-math recognition treats them as subscript formulas and renders a run of italics.
 *
 * @param props Reasoning text, streaming state, and this turn's sources
 * @returns A reasoning segment rendered through the shared Markdown pipeline
 */
export function ReasoningSegment({
  reasoning,
  streaming,
  citations = [],
}: {
  reasoning: string;
  streaming: boolean;
  citations?: Citation[];
}) {
  return (
    <MarkdownRenderer
      content={reasoning}
      variant="reasoning"
      streaming={streaming}
      citations={citations}
    />
  );
}

/*
  Expand and collapse use different curves. That is not decoration.

  cubic-bezier(0.22,1,0.36,1) is extremely front-loaded: on expand it means "open quickly, then settle," which feels crisp; on collapse it becomes a cave-in — a 300px-tall process area drops to 133px in the first 30ms, and the body below is yanked up a long way, which reads as a layout flash. Collapse uses a standard ease-out, still finishing in 220ms, but the first 30ms only travel 20px, so it reads as gathering rather than being pulled away.

  Opacity shares the height curve, grows at the same time, and has no delay: if the two layers keep their own timing, the content is already transparent before the container has finished closing, leaving a blank that collapses in place — the other half of the same problem.
*/
const PANEL_DURATION_MS = 220;
const PANEL_EXPAND_CURVE = 'cubic-bezier(0.22,1,0.36,1)';
const PANEL_COLLAPSE_CURVE = 'cubic-bezier(0.4,0,0.2,1)';

/**
 * Collapsible content panel.
 *
 * Animation strategy: grid-template-rows 0fr → 1fr.
 * - More precise than max-height: the height equals the content height, with no redundant "9999px → 0" calculation;
 * - overflow-hidden keeps the content from spilling while collapsed.
 */
export function DisclosurePanel({
  id,
  expanded,
  children,
}: {
  id: string;
  expanded: boolean;
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.inert = !expanded;
    }
  }, [expanded]);

  const timing = `${PANEL_DURATION_MS}ms ${expanded ? PANEL_EXPAND_CURVE : PANEL_COLLAPSE_CURVE}`;

  return (
    <div
      id={id}
      aria-hidden={!expanded}
      style={{
        display: 'grid',
        gridTemplateRows: expanded ? '1fr' : '0fr',
        transition: `grid-template-rows ${timing}`,
      }}
    >
      <div
        ref={contentRef}
        className="min-h-0 overflow-hidden"
        style={{ opacity: expanded ? 1 : 0, transition: `opacity ${timing}` }}
      >
        {children}
      </div>
    </div>
  );
}
