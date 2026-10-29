import type { ReactNode } from 'react';

interface PageTransitionProps {
  children: ReactNode;
}

/**
 * 顶层页面入场过渡容器。
 *
 * 用途：承接 AdminLayout 的内容区域布局。这里不再挂载入场动画，避免路由型 tab
 * 或内容重挂载时出现整块页面闪烁。
 */
export function PageTransition({ children }: PageTransitionProps) {
  return <div className="min-h-0 flex-1">{children}</div>;
}
