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

    // 未刷新时保留原始 import 错误；拦截后 Vite 会以 undefined 完成 Promise，
    // React.lazy 随后读取 default 才会产生误导性的 TypeError。
    if (shouldReload) {
      event.preventDefault();
      reload();
    }
  };

  window.addEventListener('vite:preloadError', handlePreloadError);
  return () => window.removeEventListener('vite:preloadError', handlePreloadError);
}
