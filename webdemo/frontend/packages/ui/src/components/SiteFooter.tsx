import { requestCookieSettings } from './CookieConsent';

/**
 * 站点页脚：展示版权与按环境控制的合规信息。
 *
 * 用途：满足中国大陆网站合规要求，在登录页与主界面底部显著位置展示备案号，
 * 并提供工信部与公安备案查询链接。备案号文本为主体备案信息，作为唯一可信来源集中维护于此，
 * 由 portal 与 admin 共用，请勿在各 app 内重复硬编码。
 *
 * @param className 额外的容器类名，便于在不同布局中微调间距/背景。
 * @param variant   排版变体：`stacked` 多行居中（登录页），`inline` 水平单行（主界面页脚）。
 */
interface SiteFooterProps {
  className?: string;
  variant?: 'stacked' | 'inline';
  /** 默认跟随构建 profile；legacy 显示，gcp 隐藏。 */
  showFiling?: boolean;
  /** 默认仅在启用 GCP Cookie Consent 时显示。 */
  showCookieSettings?: boolean;
}

// 公安备案标准图标（公安部下发）。各 app 将其放在自身 public 根，用 BASE_URL 自适应
// 子路径前缀（portal /console/、admin /admin-console/），与 logo 的引用方式一致。
// 注：本共享包内缺少 vite/client 全局类型（vite 仅为根构建依赖，pnpm 隔离下无法解析），
// 故以 unknown 中转安全读取 BASE_URL；运行时由各 app 的 vite 注入为编译期常量。
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

  // 主界面：所有合规信息水平排成一行，小屏才换行
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

  // 登录页：版权与合规信息分两行居中
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
