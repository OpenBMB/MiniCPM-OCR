import { useTranslation } from 'react-i18next';
import { Button } from '@map/ui';
import { useAppStore } from '@map/store';

import { WORKSPACE_CONTROL } from '../../utils/imageParseWorkspaceStyles';

/**
 * Reading-order number switch on layout boxes; the preference is persisted and shared by single images and PDFs. When recognition boxes are hidden the numbers cannot be seen either, and the button is disabled with them.
 */
export function ImageParseOrderToggle({ disabled }: { disabled?: boolean }) {
  const { t } = useTranslation('playground');
  const shown = useAppStore((s) => s.playground.imageParseShowOrder);
  const setPrefs = useAppStore((s) => s.setPlaygroundPrefs);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={WORKSPACE_CONTROL}
      disabled={disabled}
      aria-pressed={shown}
      title={t('imageParseOrderHint')}
      onClick={() => setPrefs({ imageParseShowOrder: !shown })}
    >
      {t(shown ? 'imageParseHideOrder' : 'imageParseShowOrder')}
    </Button>
  );
}
