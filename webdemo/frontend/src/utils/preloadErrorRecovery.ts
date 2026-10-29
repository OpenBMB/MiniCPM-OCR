const PRELOAD_RELOAD_MARKER = 'map_portal_preload_reload_at';
const PRELOAD_RELOAD_GUARD_MS = 30_000;

type Reload = () => void;
type Clock = () => number;

/**
 * Reload once when Vite reports a stale dynamic-import preload.
 * A session marker prevents an inconsistent deployment from causing a loop.
 */
export function installPreloadErrorRecovery(
  reload: Reload = () => window.location.reload(),
  storage: Storage | undefined = window.sessionStorage,
  now: Clock = Date.now,
): () => void {
  const handlePreloadError = (event: Event) => {
    let shouldReload = true;
    try {
      const lastReloadAt = Number(storage?.getItem(PRELOAD_RELOAD_MARKER) ?? 0);
      shouldReload =
        !lastReloadAt || now() - lastReloadAt >= PRELOAD_RELOAD_GUARD_MS;
      if (shouldReload) {
        storage?.setItem(PRELOAD_RELOAD_MARKER, String(now()));
      }
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }

    // Until a reload, keep the original import error; after interception Vite fulfills the Promise with undefined,
    // and React.lazy only then reads default and throws a misleading TypeError.
    if (shouldReload) {
      event.preventDefault();
      reload();
    }
  };

  window.addEventListener('vite:preloadError', handlePreloadError);
  return () => window.removeEventListener('vite:preloadError', handlePreloadError);
}
