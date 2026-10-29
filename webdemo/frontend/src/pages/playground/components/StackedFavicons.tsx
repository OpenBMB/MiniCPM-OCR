/**
 * Stacked source-site icons.
 *
 * Purpose: the search row on the process timeline and the source chip under the answer share one "a stack of pages" visual. A very small horizontal footprint says "this step touched these sites," and which pages they are is carried by the drawer.
 */

import { cn } from '@map/ui';

import type { Citation } from '../types';
import { MAX_ROW_FAVICONS, STAGGER_CLASS_NAME, staggerStyle } from '../utils/answerTimeline';
import { CitationFavicon } from './CitationFavicon';

interface StackedFaviconsProps {
  /** Sources to show; only their url is used to draw the icon. */
  citations: Citation[];
  /** How many to stack at most; extras are neither shown nor counted. */
  max?: number;
  /** Outer container styles. */
  className?: string;
}

/**
 * Renders a stack of overlapping site icons.
 *
 * The icons are pure decoration (`aria-hidden`): a readable expression of the same sources is already given by the adjacent copy ("found N pages," "N pages" on the chip) and the full list in the drawer. Reading them again here would only make a screen reader speak a row as a string of meaningless domains.
 *
 * Overflow **does not report +N**: the count is in the copy beside it, and adding a +N says the same thing twice. The stack on a search row is an approximation filled from the whole message's sources (the backend does not send web_search addresses), so +N would fail to match the "found N pages" that row reports itself — `found 10 pages +26` in the screenshot came from exactly that.
 *
 * @param citations Source list
 * @param max Maximum stack count; default MAX_ROW_FAVICONS
 * @param className Outer container styles
 * @returns Stacked icons; render nothing when there are no sources
 */
export function StackedFavicons({
  citations,
  max = MAX_ROW_FAVICONS,
  className,
}: StackedFaviconsProps) {
  const visible = citations.slice(0, max);
  if (visible.length === 0) return null;

  return (
    <span className={cn('inline-flex shrink-0 items-center align-middle', className)}>
      {visible.map((citation, index) => (
        <span
          key={citation.url}
          aria-hidden="true"
          style={staggerStyle(index)}
          /*
            Overlap comes from a negative margin, and layering comes from the "stroke" held up by ring and background — there must be a ring the same color as the page between two icons, or dark site icons stacked together blur into one mass and the count cannot be told apart.
          */
          className={cn(STAGGER_CLASS_NAME, '-ml-1.5 first:ml-0')}
        >
          <CitationFavicon
            url={citation.url}
            className="size-5 rounded-full border-0 bg-muted ring-2 ring-background"
            imageClassName="size-3"
          />
        </span>
      ))}
    </span>
  );
}
