import { Outlet, useLocation } from 'react-router-dom';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';

/**
 * 门户空白布局。
 * 用途：为登录、错误和公开页面保留统一的语言切换入口，不干预各页面自己的内容布局。
 * @returns 带语言切换入口的子路由容器。
 */
export function BlankLayout() {
  const { pathname } = useLocation();
  // 协议页和体验中心都有自己的顶栏控件，避免全局浮层覆盖页面内容。
  const showFloatingLocaleSwitcher =
    !pathname.startsWith('/playground') && !pathname.startsWith('/legal');

  return (
    <>
      {showFloatingLocaleSwitcher && (
        <div className="fixed right-3 top-3 z-30 sm:right-5 sm:top-5">
          <LocaleSwitcher />
        </div>
      )}
      <Outlet />
    </>
  );
}
