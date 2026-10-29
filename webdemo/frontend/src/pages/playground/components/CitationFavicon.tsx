/**
 * Site icon for a citation source.
 *
 * Purpose: one favicon load and failure fallback for the source list, citation label, process timeline, source chip, and preview popover.
 */

import { useState } from 'react';
import { Globe2 } from 'lucide-react';

import { cn } from '@map/ui';

import { citationFavicon } from '../utils/citations';

/*
  Failure records must be module-level: the same site can appear at once on a tool row, the source chip, the drawer, and the hover card in one message. If the failure state lives only inside the component, a site with no root favicon.ico fails once in every place. Record only failures, not successes — a successful image is covered by the browser HTTP cache, so there is no need to store another copy here.
*/
const failedFavicons = new Set<string>();

interface CitationFaviconProps {
  /** Source address. */
  url: string;
  /** Icon container styles. */
  className?: string;
  /** Image styles. */
  imageClassName?: string;
}

/**
 * Shows the source favicon; on load failure or an invalid URL, shows a generic web icon.
 * @param url Source address
 * @param className Icon container styles
 * @param imageClassName Image styles
 * @returns Source site icon
 */
export function CitationFavicon({ url, className, imageClassName }: CitationFaviconProps) {
  const favicon = citationFavicon(url);
  // The initial value reads the cache, so a later-mounted same-origin icon goes straight to the fallback and does not send a request that is bound to fail
  const [failed, setFailed] = useState(() => (favicon ? failedFavicons.has(favicon) : false));
  const broken = failed || (favicon ? failedFavicons.has(favicon) : false);

  return (
    <span
      className={cn(
        'flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/40 bg-background/75',
        className,
      )}
    >
      {favicon && !broken ? (
        <img
          src={favicon}
          alt=""
          width={16}
          height={16}
          className={cn('size-4 object-contain', imageClassName)}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => {
            failedFavicons.add(favicon);
            setFailed(true);
          }}
        />
      ) : (
        <Globe2 className="size-3.5 text-muted-foreground/80" aria-hidden="true" />
      )}
    </span>
  );
}
