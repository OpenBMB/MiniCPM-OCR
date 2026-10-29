import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@map/ui';

interface ImageParseOptionInfoProps {
  label: string;
  hint: string;
}

/**
 * Show what a parse option does; it appears on hover or keyboard focus and does not take permanent space.
 * @param props Option name and description copy
 * @returns An info button that supports hover and keyboard focus
 */
export function ImageParseOptionInfo({ label, hint }: ImageParseOptionInfoProps) {
  const { t } = useTranslation('playground');

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            aria-label={t('imageParseOptionInfo', { label })}
            className="size-7 shrink-0 rounded-full p-0 text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:size-11"
          >
            <Info className="size-3.5" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-64 text-xs leading-relaxed" side="top">
          {hint}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
