/**
 * Row primitive for the answer-process timeline.
 *
 * Purpose: reasoning paragraphs and tool rows share one marker column (a bullet for reasoning, a tool icon for tools), and a vertical line under the marker connects to the next item, so one answer's process reads as a line rather than several cards.
 */

import { type ReactNode } from 'react';

import { cn } from '@map/ui';

interface ProcessRailItemProps {
  /** Content in the marker column: a bullet or a tool icon; pass null to reserve the slot without drawing (when the timeline has only one row). */
  marker: ReactNode;
  /** Whether this is the last item; the last item does not draw a connector downward. */
  last?: boolean;
  /** Failure state turns the whole row red. */
  tone?: 'default' | 'destructive';
  children: ReactNode;
}

/*
  Each item has its own entrance animation. During streaming the timeline grows one item at a time; without a transition a new row snaps into place — especially a search row, which is only an icon plus a sentence and looks hardest when it appears from nowhere.
  A keyed element runs only on first mount; appending text to an existing item does not replay it. There is no delay, so fill-mode is unnecessary (that is what STAGGER_CLASS_NAME is for, on delayed icons).
*/
const ROW_ENTER_CLASS_NAME =
  'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-300';

/**
 * Renders one timeline row (marker + body + downward connector).
 *
 * The connector is one segment per item (from under the marker to the bottom of the row), not a track through the full height: it naturally breaks at each marker, so the marker looks hung on the line rather than pierced by it.
 *
 * @param marker Marker-column content
 * @param last Whether this is the last item
 * @param tone Text tone
 * @param children Row body
 * @returns A timeline row
 */
export function ProcessRailItem({
  marker,
  last = false,
  tone = 'default',
  children,
}: ProcessRailItemProps) {
  return (
    <li
      className={cn(
        'grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-2 text-sm leading-6',
        ROW_ENTER_CLASS_NAME,
        tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      <span className="relative flex h-full justify-center">
        <span className="relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-background">
          {marker}
        </span>
        {last ? null : (
          <span
            className="absolute bottom-0 left-1/2 top-6 w-px -translate-x-1/2 bg-border"
            aria-hidden="true"
          />
        )}
      </span>
      <div className="min-w-0 pb-2">{children}</div>
    </li>
  );
}

/** Marker for a reasoning paragraph: a quiet dot, the same width and column as the tool icons. */
export function ProcessBullet() {
  return <span className="size-1.5 rounded-full bg-muted-foreground/50" aria-hidden="true" />;
}
