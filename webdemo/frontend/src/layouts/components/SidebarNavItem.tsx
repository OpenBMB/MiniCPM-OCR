import type { AppRoute } from '@map/types';
import { useAppStore } from '@map/store';
import { prefetchRoute } from '@/router/prefetch';
import { getPortalRouteTitle } from '@/router/routeCopy';
import { getIcon } from './nav-icons';
import { NavItemButton } from './nav-item-button';

interface SidebarNavItemProps {
  route: AppRoute;
  isActive: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}

/**
 * 侧栏叶子导航项（无子菜单）。
 *
 * @param route 路由数据（取 meta.title / meta.icon 渲染）
 * @param isActive 是否当前激活
 * @param collapsed 侧栏是否收起（收起时隐藏文字）
 * @param onNavigate 点击后的回调（移动端用于关闭抽屉）
 */
export function SidebarNavItem({ route, isActive, collapsed, onNavigate }: SidebarNavItemProps) {
  const locale = useAppStore((state) => state.locale);
  const basePath = route.path.replace('/*', '');
  const title = getPortalRouteTitle(route.path, locale, route.meta.title);
  const renderIcon = getIcon(route.meta.icon);
  const external = route.meta.external;

  return (
    <NavItemButton
      to={basePath}
      external={external}
      onClick={onNavigate}
      onMouseEnter={external ? undefined : () => prefetchRoute(basePath)}
      onFocus={external ? undefined : () => prefetchRoute(basePath)}
      title={collapsed ? title : undefined}
      className={`
        group flex w-full items-center rounded-lg text-[13px] font-medium overflow-hidden
        transition-all duration-200 cursor-pointer min-h-10 py-2.5 pr-3
        ${
          isActive
            ? 'bg-primary/[0.08] text-primary'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        }
      `}
    >
      <div className="w-[44px] shrink-0 flex items-center justify-center">
        {renderIcon({
          className: `shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground/70 group-hover:text-foreground'}`,
        })}
      </div>
      <span
        className={`truncate whitespace-nowrap transition-all duration-300 ${collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'}`}
      >
        {title}
      </span>
    </NavItemButton>
  );
}
