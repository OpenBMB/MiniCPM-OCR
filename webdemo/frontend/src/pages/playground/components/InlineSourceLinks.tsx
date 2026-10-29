/**
 * Inline source-title links on the process timeline.
 *
 * Purpose: a page-read row lists "which pages were read" in place, so the expanded process shows content rather than metadata. Links flow on the same line as the tool row's main copy and wrap automatically; they do not take a line of their own.
 */

import { ArrowUpRight } from 'lucide-react';

import { cn } from '@map/ui';

import type { Citation } from '../types';
import { MAX_ROW_TITLES, STAGGER_CLASS_NAME, staggerStyle } from '../utils/answerTimeline';
import {
  citationDomain,
  isNativeOpenIntent,
  openCitationWindow,
  safeCitationHref,
} from '../utils/citations';

interface InlineSourceLinksProps {
  /** Sources involved in this tool row. */
  citations: Citation[];
  /** How many to inline at most; the overflow counts toward +N. */
  max?: number;
  /** Accessible label for one link; it must say what a click will open. */
  linkLabel: (title: string) => string;
  /** Accessible label for the overflow count. */
  overflowLabel: (count: number) => string;
}

/**
 * Renders inline source-title links.
 *
 * The width budget is taken from the narrow layout "after the drawer pushes the main area open": a single item truncates at 12rem, so in both the open and closed panel states the tool row is not forced into horizontal scrolling.
 *
 * @param citations Source list
 * @param max Maximum inline count; default MAX_ROW_TITLES
 * @param linkLabel Accessible label for one link
 * @param overflowLabel Accessible label for the overflow count
 * @returns Inline links; render nothing when no source can be opened safely
 */
export function InlineSourceLinks({
  citations,
  max = MAX_ROW_TITLES,
  linkLabel,
  overflowLabel,
}: InlineSourceLinksProps) {
  const openable = citations.filter((citation) => safeCitationHref(citation.url));
  const visible = openable.slice(0, max);
  if (visible.length === 0) return null;
  const remaining = openable.length - visible.length;

  return (
    <>
      {visible.map((citation, index) => {
        const title = citation.title?.trim() || citationDomain(citation.url);
        return (
          <a
            key={citation.url}
            href={citation.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={linkLabel(title)}
            style={staggerStyle(index)}
            className={cn(
              STAGGER_CLASS_NAME,
              'ml-2 inline-flex max-w-48 items-baseline gap-0.5 align-baseline',
              'text-foreground/80 underline decoration-dotted decoration-from-font underline-offset-4',
              'transition-colors hover:text-foreground focus-visible:text-foreground',
            )}
            onClick={(event) => {
              // Modifier-clicks, middle-click, and the like are handed back to the browser; everything else uses the shared new-window open, consistent with badges and the drawer
              if (isNativeOpenIntent(event)) return;
              event.preventDefault();
              openCitationWindow(citation.url);
            }}
          >
            <span className="truncate">{title}</span>
            <ArrowUpRight className="size-3 shrink-0 self-center opacity-60" aria-hidden="true" />
          </a>
        );
      })}
      {remaining > 0 ? (
        <span className="ml-2 text-xs tabular-nums text-muted-foreground/70">
          {overflowLabel(remaining)}
        </span>
      ) : null}
    </>
  );
}
