import { useTranslation } from 'react-i18next';

/**
 * 页面级加载占位。
 *
 * 用途：作为受保护路由（AdminLayout 内）懒加载页面的 Suspense fallback，
 * 在 chunk 拉取期间填充内容区，避免布局塌陷与白屏闪烁。
 *
 * 设计：纯语义 token（不写裸色值），仅三个呼吸点，与登录页 LoginFallback 风格统一；
 * 尊重 prefers-reduced-motion 由全局动画策略兜底。
 */
export function PageLoading() {
  const { t } = useTranslation('status');
  return (
    <div
      className="flex h-full min-h-[60vh] w-full items-center justify-center"
      role="status"
      aria-label={t('loading')}
    >
      <div className="flex gap-1.5">
        <span
          className="h-2 w-2 animate-bounce rounded-full bg-primary/40"
          style={{ animationDelay: '0ms' }}
        />
        <span
          className="h-2 w-2 animate-bounce rounded-full bg-primary/40"
          style={{ animationDelay: '150ms' }}
        />
        <span
          className="h-2 w-2 animate-bounce rounded-full bg-primary/40"
          style={{ animationDelay: '300ms' }}
        />
      </div>
    </div>
  );
}
