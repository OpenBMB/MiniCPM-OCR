import { requestCookieSettings } from './CookieConsent';

/**
 * Site footer: copyright and compliance details controlled by environment.
 *
 * Purpose: meet mainland China website compliance rules by showing the ICP filing number prominently at the bottom of the login page and the main UI,
 * with links to look it up at MIIT and in the public-security filing. The filing-number text is the entity filing record, maintained here as the only source of truth,
 * shared by portal and admin. Do not hard-code it again inside each app.
 *
 * @param className Extra container classes, for tweaking spacing or background in different layouts.
 * @param variant   Layout variant: `stacked` is centered on several lines (login page), `inline` is one horizontal line (main UI footer).
 */
interface SiteFooterProps {
  className?: string;
  variant?: 'stacked' | 'inline';
  /** Follows the build profile by default; shown for legacy, hidden for gcp. */
  showFiling?: boolean;
  /** Shown by default only when GCP Cookie Consent is enabled. */
  showCookieSettings?: boolean;
}

// Standard public-security filing icon (issued by the Ministry of Public Security). Each app puts it at its own public root and uses BASE_URL to adapt
// to the subpath prefix (portal /console/, admin /admin-console/), the same way the logo is referenced.
// Note: this shared package has no vite/client global types (vite is only a root build dependency and cannot be resolved under pnpm isolation),
// so BASE_URL is read safely through unknown; at runtime each app’s vite injects it as a compile-time constant.
const baseUrl = (import.meta as unknown as { env: { BASE_URL: string } }).env.BASE_URL;
const gonganIcon = `${baseUrl}gongan-beian.png`;

export function SiteFooter({
  className = '',
  variant = 'stacked',
  showFiling: showFilingProp,
  showCookieSettings: showCookieSettingsProp,
}: SiteFooterProps) {
  const env = (
    import.meta as unknown as {
      env: { VITE_AUTH_PROFILE?: string; VITE_COOKIE_CONSENT_ENABLED?: string };
    }
  ).env;
  const isGcp = env.VITE_AUTH_PROFILE === 'gcp';
  const showFiling = showFilingProp ?? !isGcp;
  const showCookieSettings =
    showCookieSettingsProp ?? (isGcp && env.VITE_COOKIE_CONSENT_ENABLED === 'true');
  const isEnglish = typeof document !== 'undefined' && document.documentElement.lang === 'en-US';
  const copyright = isEnglish
    ? 'All rights reserved © Beijing ModelBest Intelligent Technology Co., Ltd. 2026'
    : '版权所有 © 北京面壁智能科技股份有限公司 2026';

  const gongan = (
    <a
      href="http://www.beian.gov.cn/portal/registerSystemInfo?recordcode=11010802040079"
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
    >
      <img src={gonganIcon} alt="" aria-hidden className="h-3.5 w-3.5" />
      {isEnglish ? 'Public Security Filing No. 11010802040079' : '京公网安备 11010802040079号'}
    </a>
  );

  const divider = <span className="text-muted-foreground/40">|</span>;

  const icp = (
    <a
      href="https://beian.miit.gov.cn/"
      target="_blank"
      rel="noreferrer"
      className="transition-colors hover:text-foreground"
    >
      {isEnglish ? 'ICP Filing No. 2023004350-1' : '京ICP备2023004350号-1'}
    </a>
  );

  const cookieSettings = showCookieSettings ? (
    <button
      type="button"
      onClick={requestCookieSettings}
      className="transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
    >
      {isEnglish ? 'Cookie Settings' : 'Cookie 设置'}
    </button>
  ) : null;
  const filingItems = showFiling ? (
    <>
      {gongan}
      {divider}
      {icp}
    </>
  ) : null;

  // Main UI: all compliance details sit on one horizontal line, and wrap only on a small screen.
  if (variant === 'inline') {
    return (
      <footer
        className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-4 text-center text-xs text-muted-foreground ${className}`}
      >
        <span>{copyright}</span>
        <span className="text-muted-foreground/40">·</span>
        {filingItems}
        {showFiling && cookieSettings && <span className="text-muted-foreground/40">·</span>}
        {cookieSettings}
      </footer>
    );
  }

  // Login page: copyright and compliance details are centered on two lines.
  return (
    <footer
      className={`flex flex-col items-center gap-1.5 px-4 py-5 text-center text-xs leading-relaxed text-muted-foreground ${className}`}
    >
      <p>{copyright}</p>
      <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        {filingItems}
        {showFiling && cookieSettings && <span className="text-muted-foreground/40">|</span>}
        {cookieSettings}
      </p>
    </footer>
  );
}
