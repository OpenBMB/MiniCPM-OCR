import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installPreloadErrorRecovery } from './preloadErrorRecovery';

describe('installPreloadErrorRecovery', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('reloads once for a Vite preload error and prevents a reload loop', () => {
    const reload = vi.fn();
    const now = vi.fn(() => 1_000);
    const cleanup = installPreloadErrorRecovery(reload, sessionStorage, now);

    const firstEvent = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(firstEvent);

    expect(firstEvent.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);

    const secondEvent = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(secondEvent);

    expect(secondEvent.defaultPrevented).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('allows a new recovery after the previous guard window expires', () => {
    const reload = vi.fn();
    let currentTime = 1_000;
    const cleanup = installPreloadErrorRecovery(
      reload,
      sessionStorage,
      () => currentTime,
    );

    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    currentTime += 31_000;
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));

    expect(reload).toHaveBeenCalledTimes(2);

    cleanup();
  });
});
