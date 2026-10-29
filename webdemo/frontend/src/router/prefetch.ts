import { routePrefetchers } from './routes';

// Remember prefixes that already triggered a preload, so the request is not sent again.
const prefetched = new Set<string>();

/**
 * Find the page preload factory key for a path prefix.
 * @param path Target path (for example /keys or /models).
 * @returns The matched prefix key, or undefined when nothing matches.
 */
function matchPrefix(path: string): string | undefined {
  return Object.keys(routePrefetchers).find((key) => path === key || path.startsWith(`${key}/`));
}

/**
 * Preload the page chunk for a path, when one exists.
 * Idempotent: each page triggers once; import() caches the module, so the later real render hits instantly.
 * @param path Target route path, usually the sidebar menu’s to.
 */
export function prefetchRoute(path: string): void {
  const key = matchPrefix(path);
  if (!key || prefetched.has(key)) return;
  prefetched.add(key);
  // A preload failure does not affect the main flow (a real click tries again and goes through retry), so swallow it.
  routePrefetchers[key]().catch(() => {
    prefetched.delete(key);
  });
}

/**
 * Preload every business page one by one while the browser is idle, so the first switch does not wait.
 * Queue them instead of fetching concurrently, so they do not compete with critical first-screen resources for bandwidth.
 * @returns A cleanup function that cancels idle tasks not yet run on unmount.
 */
export function prefetchAllRoutesOnIdle(): () => void {
  const keys = Object.keys(routePrefetchers);
  let cancelled = false;
  let handle: number | undefined;

  const ric: (cb: () => void) => number =
    typeof window.requestIdleCallback === 'function'
      ? (cb) => window.requestIdleCallback(cb, { timeout: 2000 })
      : (cb) => window.setTimeout(cb, 300);
  const cancel: (h: number) => void =
    typeof window.cancelIdleCallback === 'function'
      ? (h) => window.cancelIdleCallback(h)
      : (h) => window.clearTimeout(h);

  function step(index: number) {
    if (cancelled || index >= keys.length) return;
    handle = ric(() => {
      const key = keys[index];
      if (!prefetched.has(key)) {
        prefetched.add(key);
        routePrefetchers[key]()
          .catch(() => prefetched.delete(key))
          .finally(() => step(index + 1));
      } else {
        step(index + 1);
      }
    });
  }

  step(0);

  return () => {
    cancelled = true;
    if (handle !== undefined) cancel(handle);
  };
}
