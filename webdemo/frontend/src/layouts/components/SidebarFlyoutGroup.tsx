import { useState, useRef, useEffect, useCallback } from 'react';
import type { AppRoute } from '@map/types';
import { useAppStore } from '@map/store';
import { prefetchRoute } from '@/router/prefetch';
import { getPortalRouteTitle } from '@/router/routeCopy';
import { getIcon } from './nav-icons';
import { NavItemButton } from './nav-item-button';

interface SidebarFlyoutGroupProps {
  route: AppRoute;
  isActive: boolean;
  pathname: string;
  onNavigate?: () => void;
}

/**
 * Hover flyout for the collapsed sidebar (the submenu floats open).
 *
 * Tracks open state and flyout position from the trigger and the viewport height,
 * so the submenu does not run past the bottom of the viewport; closing is delayed 120ms on leave so the pointer can move.
 * @param route Parent route.
 * @param isActive Whether the parent is active.
 * @param pathname Current path, used to highlight children.
 * @param onNavigate Callback after a child is clicked.
 */
export function SidebarFlyoutGroup({
  route,
  isActive,
  pathname,
  onNavigate,
}: SidebarFlyoutGroupProps) {
  const locale = useAppStore((state) => state.locale);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [flyoutStyle, setFlyoutStyle] = useState<React.CSSProperties>({});

  const renderIcon = getIcon(route.meta.icon);
  const childCount = route.children?.length ?? 0;

  const scheduleClose = useCallback(() => {
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }, []);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const handleEnter = useCallback(() => {
    cancelClose();
    prefetchRoute(route.path);
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const estimatedHeight = childCount * 36 + 40;
      const viewportH = window.innerHeight;
      let top = rect.top;
      if (top + estimatedHeight > viewportH - 12) {
        top = Math.max(12, viewportH - estimatedHeight - 12);
      }
      setFlyoutStyle({ left: '68px', top: `${top}px` });
    }
    setOpen(true);
  }, [cancelClose, childCount, route.path]);

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  return (
    <div
      ref={triggerRef}
      onMouseEnter={handleEnter}
      onMouseLeave={scheduleClose}
      className="relative"
    >
      <div
        className={`
          group flex items-center rounded-lg text-[13px] font-medium overflow-hidden
          transition-all duration-200 cursor-pointer h-10
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
      </div>

      {open && (
        <div
          ref={flyoutRef}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          className="fixed z-50 ml-1"
          style={flyoutStyle}
        >
          <div className="min-w-[160px] max-h-[70vh] overflow-y-auto rounded-xl border border-border/60 bg-card p-1.5 shadow-[0_8px_30px_-4px_rgba(0,0,0,0.12)] animate-[map-flyout-in_150ms_ease-out]">
            <p className="px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
              {getPortalRouteTitle(route.path, locale, route.meta.title)}
            </p>
            {route.children?.map((child) => {
              const childActive = pathname === child.path;

              return (
                <NavItemButton
                  key={child.path}
                  to={child.path}
                  onClick={() => {
                    setOpen(false);
                    onNavigate?.();
                  }}
                  className={`
                    group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] font-medium
                    transition-colors duration-100 cursor-pointer
                    ${
                      childActive
                        ? 'bg-primary/[0.08] text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }
                  `}
                >
                  <span className="whitespace-nowrap">
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
