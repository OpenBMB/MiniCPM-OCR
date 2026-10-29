import { useTranslation } from 'react-i18next';
import { Button } from '@map/ui';
import { useAppStore } from '@map/store';

import { WORKSPACE_CONTROL } from '../../utils/imageParseWorkspaceStyles';

/**
 * 版面框上的阅读顺序序号开关；偏好持久化，单图与 PDF 共用。
 * 识别框隐藏时序号也看不到，按钮随之禁用。
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
