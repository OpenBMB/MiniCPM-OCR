import type { AppRoute } from '@map/types';

export interface BreadcrumbItem {
  title: string;
  /** Used for the link; the last item can also be clicked to jump to the current full path. */
  path: string;
}

/** Match the current pathname among a parent route’s children (exact match first, then the longest prefix). */
function findMatchingChild(parent: AppRoute, pathname: string): AppRoute | undefined {
  const children = parent.children;
  if (!children?.length) {
    return undefined;
  }

  const exact = children.find((c) => c.path === pathname);
  if (exact) {
    return exact;
  }

  let best: AppRoute | undefined;
  let bestLen = -1;
  for (const c of children) {
    if (pathname.startsWith(`${c.path}/`) || pathname === c.path) {
      if (c.path.length > bestLen) {
        bestLen = c.path.length;
        best = c;
      }
    }
  }
  return best;
}

/**
 * Build breadcrumbs from the pathname and the static route tree (including child-route titles in the sidebar).
 */
export function getBreadcrumbItems(pathname: string, routes: AppRoute[]): BreadcrumbItem[] {
  const items: BreadcrumbItem[] = [{ title: '首页', path: '/' }];

  if (pathname === '/') {
    return items;
  }

  const parent = routes.find((r) => {
    const base = r.path.replace('/*', '');
    return pathname === r.path || (r.path !== '/' && pathname.startsWith(base));
  });

  if (!parent || parent.path === '/') {
    return items;
  }

  const parentBase = parent.path.replace('/*', '');
  items.push({ title: parent.meta.title, path: parentBase });

  const child = findMatchingChild(parent, pathname);
  if (child) {
    items.push({ title: child.meta.title, path: child.path });
  }

  return items;
}
