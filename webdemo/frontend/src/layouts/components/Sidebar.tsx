import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { AppRoute } from '@map/types';
import { staticRoutes } from '@/router/routes';
import { useFeatureAccessQuery, useRewardsQuery } from '@/api/map';
import { ModelbestMark } from '@/components/ModelbestMark';
import { APP_NAME } from '@/config/brand';
import { OverlayScrollArea } from '@/components/OverlayScrollArea';
import { isRouteActive } from './sidebar-utils';
import { SidebarNavItem } from './SidebarNavItem';
import { SidebarNavGroup } from './SidebarNavGroup';
import { SidebarFlyoutGroup } from './SidebarFlyoutGroup';
import { DailyCheckinCard } from './DailyCheckinCard';

interface SidebarProps {
  collapsed: boolean;
  onNavigate?: () => void;
  onToggle?: () => void;
  routes?: AppRoute[];
  mixedMode?: boolean;
}

/**
 * Main sidebar: renders the nav tree (leaf items, collapsible parents, and a collapsed flyout) and manages which parent menus are open.
 *
 * @param collapsed Whether it is collapsed (collapsed parents use a hover flyout).
 * @param onNavigate Callback after navigation (closes the drawer on mobile).
 * @param onToggle Collapse or expand toggle callback.
 * @param routes Custom routes (defaults to non-hidden items in staticRoutes).
 */
export function Sidebar({ collapsed, onNavigate, onToggle, routes }: SidebarProps) {
  const { t } = useTranslation('shell');
  const location = useLocation();
  const navigate = useNavigate();
  const rewards = useRewardsQuery();
  const featureAccess = useFeatureAccessQuery();
  const visibleRoutes =
    routes ??
    staticRoutes.filter(
      (route) => !route.meta.hidden && (route.path !== '/voices' || featureAccess.data?.voice_clone !== false),
    );
  const docsRoute = staticRoutes.find((route) => route.path === '/docs');

  const getActiveParents = () =>
    visibleRoutes
      .filter((r) => r.children?.length && isRouteActive(r, location.pathname))
      .map((r) => r.path);

  const [openMenus, setOpenMenus] = useState<string[]>(getActiveParents);
  const [manualClosed, setManualClosed] = useState<string[]>([]);

  // Toggle a parent menu: if it is open, collapse it and record it in manualClosed; if expanding, keep only the current parent,
  // and if that parent is not currently active, also navigate to its first child route.
  function toggleMenu(route: AppRoute) {
    const path = route.path;
    const isCurrentlyOpen = openMenus.includes(path) && !manualClosed.includes(path);

    if (isCurrentlyOpen) {
      setOpenMenus((prev) => prev.filter((p) => p !== path));
      setManualClosed((prev) => [...prev, path]);
    } else {
      setOpenMenus([path]);
      setManualClosed((prev) => prev.filter((p) => p !== path));
      const firstChild = route.children?.[0];
      if (firstChild && !isRouteActive(route, location.pathname)) {
        navigate(firstChild.path);
      }
    }
  }

  return (
    <aside
      className={`
        relative z-20 flex h-full flex-col bg-card transition-all duration-300 ease-in-out
        ${collapsed ? 'w-[68px]' : 'w-60'}
      `}
    >
      {/* Brand */}
      <div className="shrink-0 pt-3 pb-1">
        <div className="flex items-center h-11 overflow-hidden">
          <div className="w-[68px] shrink-0 flex items-center justify-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary shadow-sm shadow-primary/25">
              <ModelbestMark size={20} className="text-primary-foreground" />
            </div>
          </div>
          <span
            className={`text-[17px] font-bold tracking-tight text-foreground whitespace-nowrap transition-all duration-300 overflow-hidden ${
              collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
            }`}
          >
            {APP_NAME}
          </span>
        </div>
      </div>

      {/* Nav */}
      <OverlayScrollArea
        element="nav"
        aria-label={t('navigation.mainMenu')}
        className="map-sidebar-scroll min-h-0 flex-1 px-3 py-3"
      >
        <div className="space-y-1.5">
          {visibleRoutes.map((route) => {
            const realHasChildren = (route.children?.length ?? 0) > 0;
            const active = isRouteActive(route, location.pathname);

            if (collapsed && realHasChildren) {
              return (
                <SidebarFlyoutGroup
                  key={route.path}
                  route={route}
                  isActive={active}
                  pathname={location.pathname}
                  onNavigate={onNavigate}
                />
              );
            }

            if (!collapsed && realHasChildren) {
              const isOpen =
                !manualClosed.includes(route.path) && (openMenus.includes(route.path) || active);
              return (
                <SidebarNavGroup
                  key={route.path}
                  route={route}
                  isOpen={isOpen}
                  isActive={active}
                  collapsed={collapsed}
                  onToggle={() => toggleMenu(route)}
                  onNavigate={onNavigate}
                  pathname={location.pathname}
                />
              );
            }

            return (
              <SidebarNavItem
                key={route.path}
                route={route}
                isActive={active}
                collapsed={collapsed}
                onNavigate={() => {
                  setOpenMenus([]);
                  onNavigate?.();
                }}
              />
            );
          })}
        </div>
      </OverlayScrollArea>

      <DailyCheckinCard
        collapsed={collapsed}
        dailyPoints={rewards.data?.daily_checkin_points ?? '0'}
        enabled={Boolean(rewards.data?.daily_checkin_enabled)}
        claimedToday={Boolean(rewards.data?.claimed_today)}
        onOpenRecharges={() => {
          navigate('/recharges');
          onNavigate?.();
        }}
      />

      {/* Bottom */}
      <nav
        aria-label={t('navigation.accountMenu')}
        className="shrink-0 border-t border-border px-3 py-2 space-y-1"
      >
        {docsRoute && (
          <SidebarNavItem
            route={docsRoute}
            isActive={isRouteActive(docsRoute, location.pathname)}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        )}
        {/* Personal settings: the sidebar and the top-bar user menu share the same entry. */}
        <button
          type="button"
          onClick={() => {
            navigate('/profile');
            onNavigate?.();
          }}
          className={`flex items-center rounded-lg text-[13px] transition-all duration-200 cursor-pointer h-9 w-full ${
            location.pathname.startsWith('/profile')
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
          aria-label={t('navigation.profile')}
          title={collapsed ? t('navigation.profile') : undefined}
        >
          <div className="w-[44px] shrink-0 flex items-center justify-center">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0"
            >
              <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <span
            className={`whitespace-nowrap transition-all duration-300 overflow-hidden ${collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'}`}
          >
            {t('navigation.profile')}
          </span>
        </button>
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center rounded-lg text-[13px] text-muted-foreground transition-all duration-200 hover:bg-muted hover:text-foreground cursor-pointer h-9 w-full"
            aria-label={collapsed ? t('controls.expandSidebar') : t('controls.collapseSidebar')}
          >
            <div className="w-[44px] shrink-0 flex items-center justify-center">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`shrink-0 transition-transform duration-300 ${collapsed ? 'rotate-180' : ''}`}
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </div>
            <span
              className={`whitespace-nowrap transition-all duration-300 overflow-hidden ${collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'}`}
            >
              {t('controls.collapseSidebar')}
            </span>
          </button>
        )}
      </nav>
    </aside>
  );
}
