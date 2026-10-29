/**
 * Citation badge inside the body.
 *
 * Purpose: render a Markdown link that matches a source as a superscript number with the same index as the source list. Hover shows a preview card; click opens the source panel on the right and scrolls to that item (when onActivate is not wired, fall back to opening the original in a new window).
 *
 * Why `relative + top` instead of `<sup>` / `vertical-align: super`:
 * the latter two raise the inline box and stretch the whole line height, so the body reads as jumping up and down. Relative positioning does not join line-box layout, so the badge rises visually but the layout does not move at all.
 */

import { useTranslation } from 'react-i18next';

import { cn, Tooltip, TooltipContent, TooltipTrigger } from '@map/ui';

import type { Citation } from '../types';
import { isNativeOpenIntent, openCitationWindow, safeCitationHref } from '../utils/citations';
import { CitationPreviewCard } from './CitationPreview';

interface CitationBadgeProps {
  /** Source this badge corresponds to. */
  citation: Citation;
  /** Source index (starting at 1, the same number as the references at the bottom and the source panel). */
  index: number;
  /** Takeover action when the badge is clicked (open the source panel and locate the item); when omitted, keep opening the original in a new window. */
  onActivate?: () => void;
}

/**
 * Renders a citation badge that can be previewed and followed.
 * @param citation Source this badge corresponds to
 * @param index Source index (starting at 1)
 * @param onActivate Takeover action on click; default is to open the original in a new window
 * @returns A superscript number badge; an illegal address degrades to a non-clickable plain number
 */
export function CitationBadge({ citation, index, onActivate }: CitationBadgeProps) {
  const { t } = useTranslation('playground');
  const href = safeCitationHref(citation.url);
  const label = t('citationIndexLabel', { index });

  // data-citation-badge makes MarkdownRenderer's `[&_a]` base styles skip the badge,
  // otherwise the body link's underline and primary color cover the badge's own colors.
  const badgeClassName = cn(
    'relative -top-[0.3em] mx-[0.1em] inline-flex h-[1.15em] min-w-[1.15em] items-center justify-center',
    'rounded-[0.35em] bg-muted px-[0.28em] align-baseline text-[0.7em] font-medium leading-none',
    'tabular-nums text-muted-foreground no-underline',
    'transition-colors duration-150 motion-reduce:transition-none',
  );

  if (!href) {
    return (
      <span data-citation-badge className={badgeClassName} aria-label={label}>
        {index}
      </span>
    );
  }

  return (
    <Tooltip delayDuration={160}>
      <TooltipTrigger asChild>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          data-citation-badge
          data-citation-url={href}
          aria-label={label}
          onClick={(event) => {
            // Cmd/Ctrl/middle-click still opens a new tab with native browser semantics, and does not override that habit for advanced users
            if (isNativeOpenIntent(event)) return;
            event.preventDefault();
            event.stopPropagation();
            // When a panel is wired, hand highlighting and scrolling to the panel; only when it is not (for example, a standalone preview) fall back to opening the original
            if (onActivate) onActivate();
            else openCitationWindow(href);
          }}
          className={cn(
            badgeClassName,
            'cursor-pointer hover:bg-primary/15 hover:text-primary',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          )}
        >
          {index}
        </a>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="p-0">
        <CitationPreviewCard citation={citation} />
      </TooltipContent>
    </Tooltip>
  );
}
