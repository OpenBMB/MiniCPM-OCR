/**
 * 体验中心底部免责声明栏。
 *
 * 用途：提示试用内容由 AI 生成、不代表平台立场，并给出免责声明 / 测试协议 / 隐私政策入口。
 * 体验中心为独立全屏壳，不展示备案（备案已在登录页与 AdminLayout 下的业务页常驻），故此处
 * 只承担「AI 生成免责 + 协议链接」职责。链接目标复用现有 legal 文档（terms/privacy）。
 *
 * @param className 额外容器类名，便于在布局中微调间距/背景。
 */
import { useTranslation } from 'react-i18next';

interface PlaygroundFooterProps {
  className?: string;
}

export function PlaygroundFooter({ className = '' }: PlaygroundFooterProps) {
  const { t } = useTranslation('playground');
  const base = import.meta.env.BASE_URL;
  return (
    <footer
      className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 py-4 text-center text-xs text-muted-foreground ${className}`}
    >
      <span>{t('footerDisclaimer')}</span>
      <LegalLink href={`${base}legal/terms`}>{t('disclaimer')}</LegalLink>
      <LegalLink href={`${base}legal/privacy`}>{t('privacyPolicy')}</LegalLink>
    </footer>
  );
}

/** 协议链接：新标签打开对应 legal 文档 */
function LegalLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="transition-colors hover:text-foreground"
    >
      {children}
    </a>
  );
}
