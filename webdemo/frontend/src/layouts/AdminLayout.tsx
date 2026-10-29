import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { Outlet, useLocation, Link } from 'react-router-dom';
import { useAppStore } from '@map/store';
import { SiteFooter } from '@map/ui';
import { useResponsive } from 'ahooks';
import { useTranslation } from 'react-i18next';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { TopNav } from './components/TopNav';
import { PageTransition } from '@/components/PageTransition';
import { OverlayScrollArea } from '@/components/OverlayScrollArea';
import { BillingAlertBanner } from '@/components/BillingAlertBanner';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import { staticRoutes } from '@/router/routes';
import { getBreadcrumbItems } from '@/router/breadcrumb';
import type { AppRoute } from '@map/types';

const ANIM_MS = 280;

export function AdminLayout() {
  const { t } = useTranslation('shell');
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const layoutMode = useAppStore((s) => s.layoutMode);
  const responsive = useResponsive();
  const isMobile = !responsive.lg;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);

  const { pathname } = useLocation();
  const routeKey = useMemo(() => pathname.split('/').filter(Boolean)[0] ?? '/', [pathname]);

  useGlobalShortcuts({
    onToggleSidebar: () => useAppStore.getState().toggleSidebar(),
  });

  const openMenu = useCallback(() => {
    setMounted(true);
    setClosing(false);
    requestAnimationFrame(() => setMobileMenuOpen(true));
  }, []);

  const closeMenu = useCallback(() => {
    setClosing(true);
    setMobileMenuOpen(false);
    setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, ANIM_MS);
  }, []);

  // When the viewport switches from mobile back to desktop, reset the mobile drawer state (syncing an external viewport condition; setState must run inside the effect).
  useEffect(() => {
    if (!isMobile && mounted) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setMounted(false);
      setMobileMenuOpen(false);
      setClosing(false);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [isMobile, mounted]);

  // For mixed mode: determine which top-level route is active and get its children
  const activeParentRoute = useMemo(() => {
    if (layoutMode !== 'mixed') return null;
    return (
      staticRoutes.find((r) => {
        const basePath = r.path.replace('/*', '');
        return pathname === r.path || (r.path !== '/' && pathname.startsWith(basePath));
      }) ?? null
    );
  }, [layoutMode, pathname]);

  const mixedSidebarRoutes: AppRoute[] = useMemo(() => {
    if (!activeParentRoute?.children?.length) return [];
    return activeParentRoute.children;
  }, [activeParentRoute]);

  // On mobile, always fall back to sidebar mode behavior
  const effectiveMode = isMobile ? 'sidebar' : layoutMode;

  const showSidebar =
    effectiveMode === 'sidebar' || (effectiveMode === 'mixed' && mixedSidebarRoutes.length > 0);

  return (
    <div className="flex h-screen h-dvh overflow-hidden bg-background">
      {/* Desktop sidebar — shown in sidebar mode and mixed mode (with children) */}
      {!isMobile && showSidebar && (
        <Sidebar
          collapsed={effectiveMode === 'mixed' ? false : collapsed}
          onToggle={
            effectiveMode === 'sidebar' ? () => useAppStore.getState().toggleSidebar() : undefined
          }
          routes={effectiveMode === 'mixed' ? mixedSidebarRoutes : undefined}
          mixedMode={effectiveMode === 'mixed'}
        />
      )}

      {/* Mobile drawer — always uses full sidebar */}
      {mounted && (
        <>
          <button
            type="button"
            className={`
              fixed inset-0 z-40 cursor-default
              bg-foreground/20 backdrop-blur-[2px]
              transition-opacity ease-out
              ${mobileMenuOpen && !closing ? 'opacity-100' : 'opacity-0'}
            `}
            style={{ transitionDuration: `${ANIM_MS}ms` }}
            onClick={closeMenu}
            aria-label={t('controls.closeMenu')}
          />
          <div
            className={`
              fixed inset-y-0 left-0 z-50 w-60 bg-card
              shadow-[4px_0_24px_-4px_rgba(0,0,0,0.12)]
              transition-transform
              ${mobileMenuOpen && !closing ? 'translate-x-0' : '-translate-x-full'}
            `}
            style={{
              transitionDuration: `${ANIM_MS}ms`,
              transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)',
            }}
          >
            <Sidebar collapsed={false} onNavigate={closeMenu} />
          </div>
        </>
      )}

      {/* Main content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header row */}
        <Header
          isMobile={isMobile}
          onMenuToggle={() => {
            if (isMobile) {
              if (mounted) closeMenu();
              else openMenu();
            } else {
              useAppStore.getState().toggleSidebar();
            }
          }}
          topNav={
            effectiveMode === 'top' || effectiveMode === 'mixed' ? (
              <TopNav variant={effectiveMode === 'mixed' ? 'mixed' : 'top'} />
            ) : undefined
          }
          showLogo={effectiveMode === 'top' || (effectiveMode === 'mixed' && !showSidebar)}
        />

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-hidden">
          <OverlayScrollArea element="main" className="map-main-scroll h-full bg-muted/30">
            <div className="min-h-full p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] lg:p-6 lg:pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
              {/* Breadcrumb inside content for top/mixed mode */}
              {(effectiveMode === 'top' || effectiveMode === 'mixed') && (
                <InlineBreadcrumb pathname={pathname} />
              )}
              {/* Billing alert banner: shown when the account is overdue, out of balance, or hits a user-configured alert threshold. */}
              <BillingAlertBanner />
              <PageTransition key={routeKey}>
                <Outlet />
              </PageTransition>
            </div>
          </OverlayScrollArea>
        </div>
        {/* Filing and copyright: shown only on the overview page (/). Compliance only needs the home page; other inner pages stay hidden to keep them simple. */}
        {pathname === '/' && <SiteFooter variant="inline" className="shrink-0" />}
      </div>
    </div>
  );
}

function InlineBreadcrumb({ pathname }: { pathname: string }) {
  const { t } = useTranslation('shell');
  const items = getBreadcrumbItems(pathname, staticRoutes);
  if (items.length <= 1) return null;

  return (
    <nav aria-label={t('controls.breadcrumb')} className="mb-4 flex items-center gap-1.5 text-sm">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <Fragment key={`${item.path}-${index}`}>
            {index > 0 && (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-muted-foreground/40 shrink-0"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            )}
            {isLast ? (
              <span className="font-medium text-foreground">{item.title}</span>
            ) : (
              <Link
                to={item.path}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {item.title}
              </Link>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
