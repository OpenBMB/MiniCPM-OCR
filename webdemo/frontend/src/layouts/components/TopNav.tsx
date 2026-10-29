import { useState, useRef, useEffect, useCallback, type CSSProperties } from 'react';
import { useLocation } from 'react-router-dom';
import { useAppStore } from '@map/store';
import { staticRoutes } from '@/router/routes';
import { getPortalRouteTitle } from '@/router/routeCopy';
import { getIcon } from './nav-icons';
import { NavItemButton } from './nav-item-button';
import type { AppRoute } from '@map/types';

interface TopNavProps {
  /** top: top navigation only, with icons and a hover dropdown; mixed: first level only, and the second level lives in the sidebar. */
  variant?: 'top' | 'mixed';
  onRouteClick?: (route: AppRoute) => void;
}

const navItemClass = (active: boolean) => `
  inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3
  text-[13px] font-medium leading-none transition-colors duration-150 cursor-pointer
  ${
    active
      ? 'bg-primary/[0.08] text-primary'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  }
`;

/**
 * Top-nav icon container, fixed at 16px and excluded from line-height.
 */
function NavIcon({ icon, active }: { icon?: string; active: boolean }) {
  const renderIcon = getIcon(icon);
  return (
    <span className="inline-flex size-4 shrink-0 items-center justify-center [&>svg]:block [&>svg]:size-4">
      {renderIcon({
        className: active ? 'text-primary' : 'text-muted-foreground/70',
      })}
    </span>
  );
}

/**
 * Top-level navigation: top mode has icons and a hover dropdown; mixed mode is a text tab only, and the second level lives in the sidebar.
 */
export function TopNav({ variant = 'top', onRouteClick }: TopNavProps) {
  const location = useLocation();
  const locale = useAppStore((state) => state.locale);
  const visibleRoutes = staticRoutes.filter((r) => !r.meta.hidden);
  const isMixed = variant === 'mixed';

  return (
    <nav className="flex h-8 min-w-0 items-center gap-0.5">
      {visibleRoutes.map((route) => {
        const basePath = route.path.replace('/*', '');
        const active =
          location.pathname === route.path ||
          (route.path !== '/' && location.pathname.startsWith(basePath));
        const hasChildren = (route.children?.length ?? 0) > 0;

        if (!isMixed && hasChildren) {
          return (
            <TopNavDropdown
              key={route.path}
              route={route}
              active={active}
              pathname={location.pathname}
              locale={locale}
              onRouteClick={onRouteClick}
            />
          );
        }

        return (
          <NavItemButton
            key={route.path}
            to={basePath}
            external={route.meta.external}
            onClick={() => onRouteClick?.(route)}
            className={navItemClass(active)}
          >
            {!isMixed && <NavIcon icon={route.meta.icon} active={active} />}
            <span>{getPortalRouteTitle(route.path, locale, route.meta.title)}</span>
          </NavItemButton>
        );
      })}
    </nav>
  );
}

function TopNavDropdown({
  route,
  active,
  pathname,
  locale,
  onRouteClick,
}: {
  route: AppRoute;
  active: boolean;
  pathname: string;
  locale: ReturnType<typeof useAppStore.getState>['locale'];
  onRouteClick?: (route: AppRoute) => void;
}) {
  const [open, setOpen] = useState(false);
  const [flyoutStyle, setFlyoutStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const basePath = route.path.replace('/*', '');

  const scheduleClose = useCallback(() => {
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  }, []);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const handleEnter = useCallback(() => {
    cancelClose();
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setFlyoutStyle({ left: `${rect.left}px`, top: `${rect.bottom}px` });
    }
    setOpen(true);
  }, [cancelClose]);

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  return (
    <div
      ref={triggerRef}
      className="relative shrink-0"
      onMouseEnter={handleEnter}
      onMouseLeave={scheduleClose}
    >
      <NavItemButton
        to={basePath}
        onClick={() => onRouteClick?.(route)}
        className={navItemClass(active)}
      >
        <NavIcon icon={route.meta.icon} active={active} />
        <span>{getPortalRouteTitle(route.path, locale, route.meta.title)}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`block size-3 shrink-0 text-muted-foreground/40 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </NavItemButton>

      {open && (
        <div onMouseEnter={cancelClose} className="fixed z-40 pt-1" style={flyoutStyle}>
          <div className="min-w-[180px] max-h-[70vh] space-y-0.5 overflow-y-auto rounded-xl border border-border/60 bg-card p-1.5 shadow-[0_8px_30px_-4px_rgba(0,0,0,0.12)] animate-[map-flyout-in_150ms_ease-out]">
            {route.children?.map((child) => {
              const childActive = pathname === child.path;
              const childIcon = getIcon(child.meta.icon);

              return (
                <NavItemButton
                  key={child.path}
                  to={child.path}
                  onClick={() => {
                    setOpen(false);
                    onRouteClick?.(route);
                  }}
                  className={`
                    group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-medium
                    transition-colors duration-100 cursor-pointer
                    ${
                      childActive
                        ? 'bg-primary/[0.08] text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }
                  `}
                >
                  <span className="inline-flex size-3.5 shrink-0 items-center justify-center [&>svg]:block [&>svg]:size-3.5">
                    {childIcon({
                      className: childActive
                        ? 'text-primary'
                        : 'text-muted-foreground/50 group-hover:text-foreground',
                    })}
                  </span>
                  <span className="whitespace-nowrap">{getPortalRouteTitle(child.path, locale, child.meta.title)}</span>
                </NavItemButton>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
