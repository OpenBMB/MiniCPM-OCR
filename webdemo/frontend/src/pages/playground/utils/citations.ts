/**
 * URL handling and navigation helpers for web-search citation sources.
 *
 * Purpose: domain and favicon display fallback, allowlist checks on navigation URLs, match keys between model links and source data,
 * and the shared new-window behavior for source links, reused by the process area, inline markers, and the source list.
 */

/**
 * Take the domain from a URL as the fallback label for a citation with no title.
 * @param url source URL
 * @returns domain without a www prefix; invalid URLs fall back to the original string
 */
export function citationDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Build the source site's own favicon URL, avoiding a third-party icon proxy.
 * @param url source URL
 * @returns favicon URL; undefined for an invalid URL
 */
export function citationFavicon(url: string): string | undefined {
  try {
    return `${new URL(url).origin}/favicon.ico`;
  } catch {
    return undefined;
  }
}

/**
 * Check a source navigation URL, allowing only HTTP(S).
 * @param url source URL
 * @returns an address that can be opened safely; undefined for an illegal scheme
 */
export function safeCitationHref(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build a stable key for matching a model Markdown link to source data.
 * @param url source URL
 * @returns a URL key that ignores the hash, a trailing slash, and query-parameter order
 */
export function citationURLKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    parsed.searchParams.sort();
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Take the citation-marker number a source shows externally.
 *
 * Body markers, source-panel numbers, and a source line on its own used to each compute the number as array index + 1,
 * but the array accumulates across turns and is deduped by URL, and does not match the injection order after the backend reorders each turn —
 * on a multi-turn search the three places would all point at the wrong number. They now all consume the ref issued by the backend,
 * so the number has only one source (the backend hostedSourceRegistry).
 *
 * @param citation source
 * @param fallbackIndex array index (0-based), used only when the backend did not issue a ref
 * @returns the display number (1-based)
 */
export function citationDisplayIndex(citation: { ref?: number }, fallbackIndex: number): number {
  return citation.ref && citation.ref > 0 ? citation.ref : fallbackIndex + 1;
}

/**
 * Whether the click should be handed back to the browser's native handling.
 *
 * Modifier keys, the middle mouse button, and events already intercepted by an upper layer keep their native meaning (such as "open in a new tab"),
 * or a programmatic window.open would downgrade those actions to an ordinary navigation.
 *
 * @param event mouse click event (only the minimum fields needed for the decision)
 * @returns true when this click should not be taken over
 */
export function isNativeOpenIntent(event: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  button: number;
  defaultPrevented: boolean;
}): boolean {
  return (
    event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0 || event.defaultPrevented
  );
}

/**
 * Open a source in a new window programmatically.
 *
 * Fallbacks:
 * - some browsers block an implicit target=_blank;
 * - when wrapped by middleware such as a Tooltip, a synchronous window.open after preventDefault makes sure the click always has visible feedback.
 *
 * @param href source URL
 */
export function openCitationWindow(href: string): void {
  const popup = window.open('about:blank', '_blank', 'noopener,noreferrer');
  if (!popup) {
    // The browser blocked the popup → fall back to same-window navigation, so the user can at least reach the target page
    window.location.assign(href);
    return;
  }
  popup.opener = null;
  popup.location.replace(href);
}
