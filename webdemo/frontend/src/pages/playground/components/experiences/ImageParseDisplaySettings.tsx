import { Check, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@map/store';
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  cn,
} from '@map/ui';

import { WORKSPACE_CONTROL } from '../../utils/imageParseWorkspaceStyles';

interface ImageParseDisplaySettingsProps {
  showBlocks?: boolean;
  hasBlocks: boolean;
  onToggleBlocks: () => void;
  linked?: boolean;
  onToggleLinked?: () => void;
  disabled?: boolean;
}

/**
 * 图片和 PDF 共用的显示设置，收拢识别框、阅读顺序、页眉页脚和双栏联动。
 * @param props 识别框与双栏联动受控状态
 * @returns 支持键盘和触屏的设置菜单
 */
export function ImageParseDisplaySettings({
  showBlocks = false,
  hasBlocks,
  onToggleBlocks,
  linked = true,
  onToggleLinked,
  disabled = false,
}: ImageParseDisplaySettingsProps) {
  const { t } = useTranslation('playground');
  const order = useAppStore((s) => s.playground.imageParseShowOrder);
  const hideHeaderFooter = useAppStore((s) => s.playground.imageParseHideHeaderFooter);
  const setPrefs = useAppStore((s) => s.setPlaygroundPrefs);
  const items: Array<{
    key: string;
    checked: boolean;
    disabled: boolean;
    change: () => void;
  }> = [
    {
      key: 'imageParseShowConfidence',
      checked: showBlocks,
      disabled: disabled || !hasBlocks,
      change: onToggleBlocks,
    },
    {
      key: 'imageParseShowOrder',
      checked: order,
      disabled: disabled || !hasBlocks || !showBlocks,
      change: () => setPrefs({ imageParseShowOrder: !order }),
    },
    {
      key: hideHeaderFooter ? 'imageParseShowHeaderFooter' : 'imageParseHideHeaderFooter',
      checked: !hideHeaderFooter,
      disabled,
      change: () => setPrefs({ imageParseHideHeaderFooter: !hideHeaderFooter }),
    },
  ];
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-tour="image-parse-confidence-toggle"
          disabled={disabled}
          className={cn(WORKSPACE_CONTROL, 'group gap-1.5')}
        >
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          {t('imageParseDisplaySettings')}
          <ChevronDown
            className="size-3.5 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
            aria-hidden="true"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) => (
          <DropdownMenuCheckboxItem
            key={item.key}
            checked={item.checked}
            disabled={item.disabled}
            onCheckedChange={item.change}
            onSelect={(event) => event.preventDefault()}
          >
            <Check
              className={`size-4 shrink-0 ${item.checked ? 'visible' : 'invisible'}`}
              aria-hidden="true"
            />
            {t(item.key)}
          </DropdownMenuCheckboxItem>
        ))}
        {onToggleLinked ? (
          <DropdownMenuCheckboxItem
            checked={linked}
            disabled={disabled}
            onCheckedChange={onToggleLinked}
            onSelect={(event) => event.preventDefault()}
          >
            <Check
              className={`size-4 shrink-0 ${linked ? 'visible' : 'invisible'}`}
              aria-hidden="true"
            />
            {t('imageParseLinked')}
          </DropdownMenuCheckboxItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
