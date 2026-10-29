/**
 * Retry a failed dynamic module load with increasing delay, and keep the full type of the default export.
 * @param factory Dynamic import function.
 * @param retries Maximum retries after the first failure.
 * @returns The loaded module; when retries are exhausted, the caller’s error boundary handles it.
 */
export function lazyWithRetry<T>(
  factory: () => Promise<{ default: T }>,
  retries = 3,
): Promise<{ default: T }> {
  return new Promise((resolve, reject) => {
    function attempt(remaining: number) {
      factory()
        .then(resolve)
        .catch((err: Error) => {
          if (remaining <= 0) {
            reject(err);
            return;
          }
          const delay = (retries - remaining + 1) * 1000;
          setTimeout(() => attempt(remaining - 1), delay);
        });
    }
    attempt(retries);
  });
}
