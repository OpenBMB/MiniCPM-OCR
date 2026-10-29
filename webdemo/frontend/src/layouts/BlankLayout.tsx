import { Outlet, useLocation } from 'react-router-dom';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';

/**
 * Blank portal layout.
 * Purpose: keep one language switcher on login, error, and public pages without changing each page's own content layout.
 * @returns A child-route container with a language switcher.
 */
export function BlankLayout() {
  const { pathname } = useLocation();
  // Agreement pages and the Playground have their own top-bar controls, so a global overlay does not cover page content.
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
