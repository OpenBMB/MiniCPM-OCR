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
 * Portal language switcher.
 * Purpose: switch the Chinese and English UI without reloading the page, and keep it usable with mouse, touch, and keyboard.
 * @param variant How the control is presented; docs pages use text so a lone icon is not hard to recognize.
 * @param className Classes appended to the button.
 * @returns The language button and its explanatory tooltip.
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
