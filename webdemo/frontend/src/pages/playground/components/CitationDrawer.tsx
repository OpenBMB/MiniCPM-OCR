/**
 * Source panel for an answer's citations.
 *
 * Purpose: browse every source used by this answer in one place; clicking a source opens the original in a new window. On desktop, PlaygroundLayout presents it as a non-modal side-by-side pane (the body stays readable and clickable); on a narrow screen it degrades to an overlay drawer. After a body badge is clicked, activeUrl comes in with it, and this component scrolls that item into view and keeps it selected.
 */

import { useEffect, useRef } from 'react';
import { ArrowUpRight, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@map/ui';

import type { Citation } from '../types';
import {
  citationDisplayIndex,
  citationDomain,
  citationURLKey,
  safeCitationHref,
} from '../utils/citations';
import { CitationFavicon } from './CitationFavicon';

interface CitationDrawerProps {
  /** All sources used by the answer. */
  citations: Citation[];
  /** Source address to locate and highlight; comes from a body-badge click. Omitted means highlight nothing. */
  activeUrl?: string;
  /** Close the panel. */
  onClose: () => void;
}

/**
 * Renders the citation workspace inside the Playground main layout.
 * @param citations All sources used by the answer
 * @param activeUrl Source address to locate and highlight
 * @param onClose Close the panel
 * @returns Source panel content
 */
export function CitationDrawer({ citations, activeUrl, onClose }: CitationDrawerProps) {
  const { t } = useTranslation('playground');
  const title = t('referencesTitle', { count: citations.length });
  // Compare with the normalized key: links in the model body often differ from source data by a trailing slash or query-parameter order.
  const activeKey = activeUrl ? citationURLKey(activeUrl) : undefined;
  const itemRefs = useRef(new Map<string, HTMLLIElement>());

  useEffect(() => {
    if (!activeKey) return;
    const node = itemRefs.current.get(activeKey);
    if (!node) return;
    // block:'nearest' — do not scroll when the target is already in view, so the list does not jump on every badge click.
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [activeKey]);

  return (
    <aside
      className="flex h-full min-w-0 flex-col bg-background/80"
      aria-label={title}
      data-testid="citation-drawer"
    >
      <header className="shrink-0 border-b border-border/35 bg-background/35 px-4 pb-3 pt-4 sm:px-5 sm:pb-4 sm:pt-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <p className="mt-1 text-xs text-muted-foreground/90">{t('referencesDescription')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            aria-label={t('closeReferences')}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      <ol className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-2 py-2 sm:px-3">
        {citations.map((citation, index) => {
          const href = safeCitationHref(citation.url);
          const domain = citationDomain(citation.url);
          const sourceTitle = citation.title || domain;
          const key = citationURLKey(citation.url);
          const isActive = activeKey === key;
          const content = (
            <>
              <span
                className={cn(
                  'pt-0.5 text-xs font-medium tabular-nums',
                  // The index changes color with the selection: the selected state cannot be conveyed by background color alone (color is not the only signal)
                  isActive ? 'text-primary' : 'text-muted-foreground/60',
                )}
              >
                {String(citationDisplayIndex(citation, index)).padStart(2, '0')}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2">
                  <CitationFavicon url={citation.url} className="size-5" />
                  <span className="truncate text-xs font-medium text-muted-foreground/90">
                    {domain}
                  </span>
                </span>
                <span className="mt-1 block text-sm font-semibold leading-5 text-foreground/95">
                  {sourceTitle}
                </span>
                {/*
                  Same as CitationPreview: the summary must not carry display utilities such as block. In Tailwind 3.4, display comes after line-clamp and overrides display:-webkit-box. Once clamp fails, every source expands into the full page body. line-clamp-2 is itself a block box.
                */}
                {citation.snippet ? (
                  <span className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground/90">
                    {citation.snippet}
                  </span>
                ) : null}
              </span>
              <ArrowUpRight
                className="mt-0.5 size-4 shrink-0 text-muted-foreground/60 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground"
                aria-hidden="true"
              />
            </>
          );

          const rowClassName = cn(
            'grid min-h-16 grid-cols-[1.5rem_minmax(0,1fr)_1rem] gap-2.5 rounded-xl px-2.5 py-2.5 sm:px-3',
            /*
              The selected state uses a light primary wash plus an inner stroke, and does not darken the background: same reasoning as SourcesChip, mixing the muted family into the panel background drops saturation and looks dirty. One step heavier than hover, so "the one I clicked" is distinct from "the one the pointer is passing over."
            */
            isActive ? 'bg-primary/[0.12] ring-1 ring-inset ring-primary/30' : 'bg-background/20',
          );

          return (
            <li
              key={citation.url}
              ref={(node) => {
                if (node) itemRefs.current.set(key, node);
                else itemRefs.current.delete(key);
              }}
            >
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-current={isActive ? 'true' : undefined}
                  className={cn(
                    rowClassName,
                    'group transition-[background-color,box-shadow] duration-200',
                    'hover:bg-background/65 hover:shadow-[0_10px_24px_-20px_hsl(var(--foreground)/0.35)]',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40',
                  )}
                  aria-label={`${sourceTitle}，${t('openSource')}`}
                >
                  {content}
                </a>
              ) : (
                <div className={rowClassName} aria-current={isActive ? 'true' : undefined}>
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
