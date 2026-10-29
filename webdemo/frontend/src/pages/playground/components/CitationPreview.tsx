/**
 * Hover preview card for a citation source.
 *
 * Purpose: the shared preview when hovering a body badge (CitationBadge) or another source entry, so the user can judge the source without leaving the answer. The card itself is also clickable and opens the original in a new window.
 */

import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Citation } from '../types';
import {
  citationDomain,
  isNativeOpenIntent,
  openCitationWindow,
  safeCitationHref,
} from '../utils/citations';
import { CitationFavicon } from './CitationFavicon';

interface CitationPreviewCardProps {
  /** Source to preview. */
  citation: Citation;
}

/**
 * Renders the title, domain, and summary of one source.
 * @param citation Source data
 * @returns Source preview content
 */
export function CitationPreviewCard({ citation }: CitationPreviewCardProps) {
  const { t } = useTranslation('playground');
  const domain = citationDomain(citation.url);
  const title = citation.title || domain;
  const href = safeCitationHref(citation.url);

  const inner = (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <CitationFavicon url={citation.url} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground/90">
          {domain}
        </span>
        <ExternalLink className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
      </div>
      {/*
        Neither the title nor the summary may add display utilities such as block/flex: Tailwind 3.4 places display after line-clamp, and display:block overrides the display:-webkit-box that line-clamp depends on. -webkit-line-clamp then fails, and the full page body spreads out and pushes the preview card out of the viewport.
      */}
      <p className="mt-3 line-clamp-2 text-sm font-semibold leading-5 text-foreground">{title}</p>
      {citation.snippet ? (
        <p className="mt-1.5 line-clamp-4 text-xs leading-5 text-muted-foreground/90">
          {citation.snippet}
        </p>
      ) : null}
      <p className="mt-2 text-[11px] font-medium text-primary">{t('openSource')}</p>
    </>
  );

  // The preview card itself can be clicked to open the original: avoid a non-interactive card inside the Tooltip that feels like it "cannot be clicked."
  if (!href) {
    return <div className="w-[min(22rem,calc(100vw-2rem))] p-3.5 text-left">{inner}</div>;
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-citation-url={href}
      aria-label={`${title}，${t('openSource')}`}
      onClick={(event) => {
        // Modifier key + middle click → let the native "open in a new tab" behavior keep working
        if (isNativeOpenIntent(event)) return;
        event.preventDefault();
        event.stopPropagation();
        openCitationWindow(href);
      }}
      className="block w-[min(22rem,calc(100vw-2rem))] cursor-pointer rounded-md p-3.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {inner}
    </a>
  );
}
