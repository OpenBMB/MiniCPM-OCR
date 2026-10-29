import { Fragment, useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { mapAuthApi, mapKeys, clearToken, getToken } from '@/api/map';
import { staticRoutes } from '@/router/routes';
import { getBreadcrumbItems } from '@/router/breadcrumb';
import { getPortalRouteTitle } from '@/router/routeCopy';
import { ModelbestMark } from '@/components/ModelbestMark';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { APP_NAME } from '@/config/brand';
import { useAppStore } from '@map/store';

interface HeaderProps {
  isMobile: boolean;
  onMenuToggle: () => void;
  topNav?: React.ReactNode;
  showLogo?: boolean;
}

export function Header({ isMobile, onMenuToggle, topNav, showLogo }: HeaderProps) {
  const { t } = useTranslation('shell');
  // 首帧即可从 localStorage 同步读出登录态，据此决定右侧渲染，避免刷新时先闪「登录」按钮
  const hasToken = Boolean(getToken());
  // 当前用户信息：照搬老 portal，登录后查 /me（仅在有 token 时启用）
  const meQuery = useQuery({
    queryKey: mapKeys.me(),
    queryFn: mapAuthApi.me,
    enabled: hasToken,
    retry: false,
  });
  const user = meQuery.data ?? null;
  const locale = useAppStore((state) => state.locale);
  const navigate = useNavigate();
  const location = useLocation();

  function handleLogout() {
    clearToken();
    navigate('/login', { replace: true });
  }

  const breadcrumbItems = getBreadcrumbItems(location.pathname, staticRoutes);
  const localizedBreadcrumbItems = breadcrumbItems.map((item) => ({
    ...item,
    title: getPortalRouteTitle(item.path, locale, item.title),
  }));
  const mobilePageTitle =
    localizedBreadcrumbItems.length > 1
      ? localizedBreadcrumbItems
          .slice(1)
          .map((i) => i.title)
          .join(' · ')
      : getPortalRouteTitle('/', locale, '首页');

  return (
    <>
      <header className="shrink-0 bg-card relative z-30">
        <div className="flex h-14 items-center justify-between px-4 lg:px-6">
          {/* Left */}
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {isMobile && (
              <button
                type="button"
                onClick={onMenuToggle}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
                aria-label={t('controls.openMenu')}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
            )}

            {/* Logo — top 模式始终显示；mixed 模式在无侧栏时显示（有二级菜单时 Logo 在侧栏） */}
            {!isMobile && showLogo && (
              <Link to="/" className="flex items-center gap-2 shrink-0 mr-1">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shadow-sm shadow-primary/25">
                  <ModelbestMark size={18} className="text-primary-foreground" />
                </div>
                <span className="text-[15px] font-bold tracking-tight text-foreground">
                  {APP_NAME}
                </span>
              </Link>
            )}

            {/* Breadcrumb — only in sidebar mode */}
            {!topNav && (
              <nav aria-label={t('controls.breadcrumb')} className="hidden lg:flex items-center gap-1.5 text-sm">
                {localizedBreadcrumbItems.map((item, index) => {
                  const isLast = index === localizedBreadcrumbItems.length - 1;
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
            )}

            {/* Mobile title */}
            {isMobile && (
              <span className="text-sm font-medium text-foreground">{mobilePageTitle}</span>
            )}

            {/* Top navigation (top/mixed mode) */}
            {!isMobile && topNav && <div className="ml-1 min-w-0 flex-1">{topNav}</div>}
          </div>

          {/* Right */}
          <div className="flex items-center gap-1">
            <LocaleSwitcher />
            {/* 三态：已拿到用户 → 用户菜单；有 token 且 /me 未失败 → 骨架占位（无抖动，不闪登录）；否则 → 登录按钮 */}
            {renderUserSlot()}
          </div>
        </div>
      </header>
    </>
  );

  /** 用户区三态渲染：用户菜单 / 占位骨架 / 登录按钮（抽出避免 JSX 内嵌套三元） */
  function renderUserSlot() {
    if (user) {
      return (
        <UserDropdown
          onLogout={handleLogout}
          canAccessAdmin={user.platform_role === 'admin' || user.platform_role === 'operator'}
        />
      );
    }
    if (hasToken && !meQuery.isError) {
      return <UserPlaceholder />;
    }
    return (
      <button
        type="button"
        onClick={() => navigate('/login')}
        className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-xs font-medium text-primary-foreground shadow-sm shadow-primary/25 transition-colors hover:bg-primary/90 cursor-pointer"
      >
        {t('account.signIn')}
      </button>
    );
  }
}

/**
 * 用户区占位骨架：在 /me 返回前展示，尺寸与 UserDropdown 触发器一致，避免登录态切换时的布局抖动与「登录」闪烁。
 */
function UserPlaceholder() {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5" aria-hidden="true">
      <div className="h-8 w-8 rounded-full bg-muted/70 animate-pulse" />
      <div className="hidden sm:block h-4 w-20 rounded bg-muted/70 animate-pulse" />
    </div>
  );
}

function UserDropdown({
  onLogout,
  canAccessAdmin,
}: {
  onLogout: () => void;
  canAccessAdmin: boolean;
}) {
  const { t } = useTranslation('shell');
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        closeDropdown();
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  function openDropdown() {
    clearTimeout(timeoutRef.current);
    setOpen(true);
    requestAnimationFrame(() => setVisible(true));
  }

  function closeDropdown() {
    setVisible(false);
    timeoutRef.current = setTimeout(() => setOpen(false), 200);
  }

  function toggle() {
    if (open) closeDropdown();
    else openDropdown();
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={t('controls.openUserMenu')}
        aria-haspopup="true"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-xl px-2 py-1.5 transition-all hover:bg-muted/60 cursor-pointer"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary-400 to-primary-600 text-primary-foreground shadow-sm shadow-primary/20">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`hidden sm:block text-muted-foreground/60 transition-transform duration-200 ${visible ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          className={`
            absolute right-0 top-full mt-2 w-52 rounded-xl bg-card py-1.5 z-40
            shadow-[0_12px_40px_rgba(0,0,0,0.12),0_4px_12px_rgba(0,0,0,0.06)]
            transition-all duration-200 origin-top-right
            ${visible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 -translate-y-1'}
          `}
        >
          <div className="py-1.5 px-1.5">
            {canAccessAdmin && (
              <button
                type="button"
                onClick={() => {
                  closeDropdown();
                  // 管理台是独立部署于 /admin-console/ 的 SPA，整页跳转而非 SPA 路由
                  window.location.assign('/admin-console/');
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground cursor-pointer"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 2 4 5v6c0 5 3.4 8.4 8 10 4.6-1.6 8-5 8-10V5l-8-3Z" />
                </svg>
                {t('account.openAdmin')}
              </button>
            )}
            <Link
              to="/profile"
              onClick={closeDropdown}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground cursor-pointer"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span className="flex-1 text-left">{t('navigation.profile')}</span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-muted-foreground/40"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </Link>
            <button
              type="button"
              onClick={() => {
                closeDropdown();
                setTimeout(onLogout, 200);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground cursor-pointer"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              {t('account.signOut')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
