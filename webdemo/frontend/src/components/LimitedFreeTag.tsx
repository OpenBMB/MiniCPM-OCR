import { Badge } from '@map/ui';
import { useTranslation } from 'react-i18next';

/**
 * "Free calls" tag: shown next to the model name while the model is inside its free pricing window.
 * The portal dropdown (top bar) and the model list share one component so the copy and style stay consistent; the container uses items-center so it lines up with the name.
 * @param className Extra classes (for example inline spacing inside a list item).
 * @returns The small free-calls badge.
 */
export function LimitedFreeTag({ className }: { className?: string }) {
  const { t } = useTranslation('models');
  return (
    <Badge
      variant="warning"
      className={`shrink-0 px-1.5 py-0 text-[10px] font-medium leading-tight ${className ?? ''}`}
    >
      {t('limitedFree')}
    </Badge>
  );
}
