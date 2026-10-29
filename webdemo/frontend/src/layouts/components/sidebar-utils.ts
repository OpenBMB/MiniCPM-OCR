import type { AppRoute } from '@map/types';

/**
 * Decide whether a route is active.
 *
 * Wildcard parents (`/*`) match by prefix; leaf routes match exactly,
 * so `/eval` is not highlighted under `/eval/create`.
 * @param route Route to test.
 * @param pathname Current location.pathname.
 * @returns Whether it is active.
 */
export function isRouteActive(route: AppRoute, pathname: string): boolean {
  const basePath = route.path.replace('/*', '');
  if (route.path.endsWith('/*')) {
    return (
      pathname === basePath || pathname === `${basePath}/` || pathname.startsWith(`${basePath}/`)
    );
  }
  return pathname === route.path;
}
