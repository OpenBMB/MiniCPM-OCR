import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@map/ui';

interface ImageParseOptionInfoProps {
  label: string;
  hint: string;
}

/**
 * 展示解析选项的功能说明；悬停或键盘聚焦时出现，不占用常驻空间。
 * @param props 选项名称与说明文案
 * @returns 支持悬停和键盘聚焦的 info 按钮
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
