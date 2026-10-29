import type { AppRoute } from '@map/types';

/**
 * 判断路由是否处于激活态。
 *
 * 通配父路由（`/*`）用前缀匹配；叶子路由仅精确匹配，
 * 避免 `/eval` 在 `/eval/create` 下被误高亮。
 * @param route 待判断的路由
 * @param pathname 当前 location.pathname
 * @returns 是否激活
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
