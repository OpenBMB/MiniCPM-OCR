import { Languages } from 'lucide-react';
import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@map/ui';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@map/store';
import { setApplicationLocale } from '@/i18n';

interface LocaleSwitcherProps {
  variant?: 'icon' | 'text';
  className?: string;
}

/**
 * 门户语言切换控件。
 * 用途：在不刷新页面的前提下切换中英文界面，并保证鼠标、触摸和键盘均可操作。
 * @param variant 控件呈现形式；文档页使用文字形式避免孤立图标难以辨识。
 * @param className 追加到按钮的样式类。
 * @returns 语言切换按钮与说明 Tooltip。
 */
export function LocaleSwitcher({ variant = 'icon', className }: LocaleSwitcherProps) {
  const locale = useAppStore((state) => state.locale);
  const { t } = useTranslation('shell');
  const targetLocale = locale === 'zh-CN' ? 'en-US' : 'zh-CN';
  const targetLocaleText = targetLocale === 'en-US' ? 'EN' : '中文';
  const label = t(
    targetLocale === 'en-US' ? 'language.switchToEnglish' : 'language.switchToChinese',
  );

  async function handleSwitch(): Promise<void> {
    await setApplicationLocale(targetLocale);
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={variant === 'icon' ? 'icon' : 'sm'}
          className={
            variant === 'icon'
              ? `h-11 w-11 sm:h-8 sm:w-8 ${className ?? ''}`
              : `h-11 min-w-11 px-3 sm:h-8 ${className ?? ''}`
          }
          aria-label={label}
          onClick={handleSwitch}
        >
          {variant === 'icon' ? (
            <Languages className="size-4" aria-hidden="true" />
          ) : (
            <span>{targetLocaleText}</span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
