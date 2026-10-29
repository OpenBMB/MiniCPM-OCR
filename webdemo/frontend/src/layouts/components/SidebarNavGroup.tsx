import type { AppRoute } from '@map/types';
import { useAppStore } from '@map/store';
import { prefetchRoute } from '@/router/prefetch';
import { getPortalRouteTitle } from '@/router/routeCopy';
import { getIcon } from './nav-icons';
import { NavItemButton } from './nav-item-button';

interface SidebarNavGroupProps {
  route: AppRoute;
  isOpen: boolean;
  isActive: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
  pathname: string;
}

/**
 * Collapsible parent menu (with children) for the expanded sidebar.
 *
 * @param route Parent route (children are the submenu items).
 * @param isOpen Whether the submenu is expanded.
 * @param isActive Whether the parent is active.
 * @param collapsed Whether the sidebar is collapsed.
 * @param onToggle Toggle expand or collapse when the parent title is clicked.
 * @param onNavigate Callback after a child is clicked.
 * @param pathname Current path, used to highlight children.
 */
export function SidebarNavGroup({
  route,
  isOpen,
  isActive,
  collapsed,
  onToggle,
  onNavigate,
  pathname,
}: SidebarNavGroupProps) {
  const locale = useAppStore((state) => state.locale);
  const renderIcon = getIcon(route.meta.icon);
  const title = getPortalRouteTitle(route.path, locale, route.meta.title);

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        onMouseEnter={() => prefetchRoute(route.path)}
        onFocus={() => prefetchRoute(route.path)}
        title={collapsed ? title : undefined}
        className={`
          group flex w-full items-center rounded-lg text-[13px] font-medium overflow-hidden
          transition-all duration-200 cursor-pointer min-h-10 py-2.5 pr-3
          ${
            isActive ? 'text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          }
        `}
      >
        <div className="w-[44px] shrink-0 flex items-center justify-center">
          {renderIcon({
            className: `shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground/70 group-hover:text-foreground'}`,
          })}
        </div>
        <span
          className={`flex-1 truncate whitespace-nowrap text-left transition-all duration-300 ${collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'}`}
        >
          {title}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-muted-foreground/40 transition-all duration-200 ${isOpen ? 'rotate-90' : ''} ${collapsed ? 'w-0 opacity-0' : 'opacity-100'}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>

      {/* Children */}
      {!collapsed && (
        <div
          className="overflow-hidden transition-all duration-200"
          style={{ maxHeight: isOpen ? `${(route.children?.length ?? 0) * 44 + 12}px` : '0px' }}
        >
          <div className="ml-[22px] mt-1.5 space-y-1.5">
            {route.children?.map((child) => {
              const childActive = pathname === child.path;

              return (
                <NavItemButton
                  key={child.path}
                  to={child.path}
                  onClick={onNavigate}
                  className={`
                    group flex w-full items-center rounded-lg px-3 py-2 text-[13px] font-medium
                    transition-colors duration-150 cursor-pointer
                    ${
                      childActive
                        ? 'bg-primary/[0.08] text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }
                  `}
                >
                  <span className="truncate">
                    {getPortalRouteTitle(child.path, locale, child.meta.title)}
                  </span>
                </NavItemButton>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
