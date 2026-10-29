import { useTranslation } from 'react-i18next';

/**
 * Page-level loading placeholder.
 *
 * Purpose: Suspense fallback for lazy pages inside protected routes (AdminLayout),
 * filling the content area while the chunk loads so the layout does not collapse or flash white.
 *
 * Design: semantic tokens only (no raw color values), just three breathing dots, matching the login page LoginFallback;
 * prefers-reduced-motion is handled by the global motion policy.
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
