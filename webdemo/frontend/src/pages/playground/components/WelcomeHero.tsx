/**
 * 体验中心欢迎语。
 *
 * 用途：对话开始前展示在输入框上方的居中欢迎标题，呼应火山方舟的欢迎区。
 */

import { ModelbestMark } from '@/components/ModelbestMark';
import { APP_NAME } from '@/config/brand';
import { useTranslation } from 'react-i18next';

/** 居中欢迎标题 */
export function WelcomeHero() {
  const { t } = useTranslation('playground');
  return (
    <div className="flex flex-col items-center gap-3 pb-2 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary shadow-sm shadow-primary/25">
        <ModelbestMark size={26} className="text-primary-foreground" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        {t('welcomeHeading', { name: APP_NAME })}
      </h1>
      <p className="text-sm text-muted-foreground">{t('welcomeDescription')}</p>
    </div>
  );
}
