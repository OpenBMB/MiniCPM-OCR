import type { AppRoute } from '@map/types';

export interface BreadcrumbItem {
  title: string;
  /** 用于链接；最后一项也可点击跳转当前完整路径 */
  path: string;
}

/** 在父路由的 children 中匹配当前 pathname（精确优先，其次最长前缀） */
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
 * 根据 pathname 与静态路由树生成面包屑（含侧边栏 children 子路由标题）。
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
