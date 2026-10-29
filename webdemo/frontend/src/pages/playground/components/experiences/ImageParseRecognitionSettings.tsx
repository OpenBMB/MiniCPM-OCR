import { ChevronDown, Info, Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@map/ui';

import { WORKSPACE_CONTROL } from '../../utils/imageParseWorkspaceStyles';

interface ImageParseRecognitionSettingsProps {
  upright: boolean;
  onUprightChange: (enabled: boolean) => void;
  recognizeSeal: boolean;
  onRecognizeSealChange: (enabled: boolean) => void;
  recognizeChart?: boolean;
  onRecognizeChartChange?: (enabled: boolean) => void;
  disabled?: boolean;
}

/**
 * Gather the options that affect the next full-text recognition, and do not mix them with original-display settings.
 * @param props Controlled state for rotation adaptation, seal, and chart display, and the disabled flag while a request is in flight
 * @returns A recognition-settings menu that supports keyboard and touch
 */
export function ImageParseRecognitionSettings({
  upright,
  onUprightChange,
  recognizeSeal,
  onRecognizeSealChange,
  recognizeChart = true,
  onRecognizeChartChange = () => undefined,
  disabled = false,
}: ImageParseRecognitionSettingsProps) {
  const { t } = useTranslation('playground');
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          data-tour="image-parse-recognition-settings"
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          className={cn(WORKSPACE_CONTROL, 'group gap-1.5')}
        >
          <Settings2 className="size-4" aria-hidden="true" />
          {t('imageParseRecognitionSettings')}
          <ChevronDown
            className="size-3.5 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
            aria-hidden="true"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <RecognitionSettingItem
          dataTour="image-parse-recognition-seal"
          label={t('imageParseRecognizeSeal')}
          hint={t('imageParseRecognizeSealHint')}
          checked={recognizeSeal}
          onCheckedChange={onRecognizeSealChange}
        />
        <RecognitionSettingItem
          dataTour="image-parse-recognition-chart"
          label={t('imageParseRecognizeChart')}
          hint={t('imageParseRecognizeChartHint')}
          checked={recognizeChart}
          onCheckedChange={onRecognizeChartChange}
        />
        <RecognitionSettingItem
          dataTour="image-parse-recognition-upright"
          label={t('imageParseUpright')}
          hint={t('imageParseUprightHint')}
          checked={upright}
          onCheckedChange={onUprightChange}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface RecognitionSettingItemProps {
  dataTour: string;
  label: string;
  hint: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/**
 * Renders a recognition-settings item with a descriptive Tooltip and a controlled Switch.
 * @param props Setting copy, current state, and toggle callback
 * @returns A recognition-settings row in the menu
 */
function RecognitionSettingItem({
  dataTour,
  label,
  hint,
  checked,
  onCheckedChange,
}: RecognitionSettingItemProps) {
  return (
    <DropdownMenuItem
      data-tour={dataTour}
      onSelect={(event) => {
        event.preventDefault();
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) {
          return;
        }
        event.preventDefault();
        onCheckedChange(!checked);
      }}
      className="items-center justify-between gap-3"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate">{label}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`${label}: ${hint}`}
              className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <Info className="size-3.5" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" align="start" className="max-w-64">
            {hint}
          </TooltipContent>
        </Tooltip>
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </DropdownMenuItem>
  );
}
