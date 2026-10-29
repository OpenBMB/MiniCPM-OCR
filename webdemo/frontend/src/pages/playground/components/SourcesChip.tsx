/**
 * Source chip under an answer.
 *
 * Purpose: replace the whole horizontally scrolling card row with one chip of "a stack of site icons + N pages," leaving a single entry to the source drawer between the answer and the process. Source titles, summaries, and indexes are all carried by the drawer and are not repeated under the body.
 */

import { useTranslation } from 'react-i18next';

import { cn } from '@map/ui';

import type { Citation } from '../types';
import { StackedFavicons } from './StackedFavicons';

interface SourcesChipProps {
  /** All sources used by this answer. */
  citations: Citation[];
  /** Open the source drawer. */
  onOpen?: () => void;
  /** Whether the source drawer is currently open (for the chip's aria-expanded). */
  panelOpen?: boolean;
}

/**
 * Renders the source chip.
 * @param citations All sources used by this answer
 * @param onOpen Open the source drawer
 * @param panelOpen Whether the source drawer is already open
 * @returns The source chip; render nothing when there are no sources or the drawer cannot be opened
 */
export function SourcesChip({ citations, onOpen, panelOpen }: SourcesChipProps) {
  const { t } = useTranslation('playground');
  if (citations.length === 0 || !onOpen) return null;

  const label = t('sourcesChipLabel', { count: citations.length });

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-expanded={panelOpen}
      aria-label={`${label}，${t('openReferences')}`}
      data-testid="sources-chip"
      className={cn(
        /*
          mt-1 rather than copying the metrics row's mt-2.5 below: the body line above is leading-7 and brings 7.5px of half-leading, and the spacing the eye sees is "half-leading + margin." 4 + 7.5 ≈ 10 + 1.5, which is what lands the chip in the middle; writing the same number on both sides makes it sit noticeably low. This assumes the last body's bottom margin is already cleared (see MarkdownRenderer).
        */
        'mt-1 inline-flex min-h-9 items-center gap-2 rounded-full bg-muted py-1.5 pl-2.5 pr-3',
        'text-xs text-muted-foreground transition-colors duration-200',
        /*
          Hover uses a light primary wash, not a darker gray. --muted-foreground is a low-saturation mid gray (220 9% 46%). Mixing it into a light background pulls the saturation down with it, and the mixed color lands exactly on --border — filling a whole block with the color used to draw separators, the one place in this cool-blue interface that leaves the blue axis, so it looks dirty. primary has the same value and a centered lightness in both light and dark themes, so switching to it is feedback in the same direction in both modes; 8% is taken from the existing hover of the same kind in @map/ui.
        */
        'hover:bg-primary/[0.08] hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
      )}
    >
      <StackedFavicons citations={citations} />
      <span className="tabular-nums">{label}</span>
    </button>
  );
}
