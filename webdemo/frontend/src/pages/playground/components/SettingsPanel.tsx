/**
 * Parameter settings panel (dialog).
 *
 * Purpose: adjust chat sampling, the reasoning-parameter style, and the v4.7 image compression ratio. Slider needs are carried by a number input for now (avoid adding an @map/ui primitive), and the range is constrained by min/max/step.
 */

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@map/ui';
import { useTranslation } from 'react-i18next';
import type { PlaygroundParams, ThinkingStyle } from '../types';
import { supportsImageDownsampleMode } from '../utils/params';

interface SettingsPanelProps {
  open: boolean;
  modelId: string;
  onOpenChange: (open: boolean) => void;
  params: PlaygroundParams;
  /** Whether the current model supports deep reasoning; hide reasoning settings when it does not. */
  showReasoning?: boolean;
  onUpdate: (patch: Partial<PlaygroundParams>) => void;
  /** Streaming-output switch */
  onStreamChange: (stream: boolean) => void;
  onReset: () => void;
}

/**
 * Parameter settings dialog.
 */
export function SettingsPanel({
  open,
  modelId,
  onOpenChange,
  params,
  showReasoning = true,
  onUpdate,
  onStreamChange,
  onReset,
}: SettingsPanelProps) {
  const { t } = useTranslation('playground');
  const styleLabels: Record<ThinkingStyle, string> = {
    reasoning_effort: t('thinkingStyleReasoningEffort'),
    thinking: t('thinkingStyleThinking'),
    both: t('thinkingStyleBoth'),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>{t('parameterSettings')}</DialogTitle>
          <DialogDescription>{t('settingsDescription')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 px-1 py-2">
          <NumberField
            id="temperature"
            label={t('temperature')}
            hint={t('temperatureHint')}
            value={params.temperature}
            min={0}
            max={2}
            step={0.1}
            onChange={(v) => onUpdate({ temperature: v })}
          />
          <NumberField
            id="top_p"
            label={t('topP')}
            hint={t('topPHint')}
            value={params.topP}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => onUpdate({ topP: v })}
          />
          <NumberField
            id="max_tokens"
            label={t('maxTokens')}
            hint={t('maxTokensHint')}
            value={params.maxTokens}
            min={0}
            max={32768}
            step={128}
            onChange={(v) => onUpdate({ maxTokens: v === undefined ? undefined : Math.round(v) })}
          />

          {supportsImageDownsampleMode(modelId) && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="image_downsample_mode">{t('imageDownsampleMode')}</Label>
              <Select
                value={params.imageDownsampleMode ?? ''}
                onValueChange={(mode) =>
                  onUpdate({
                    imageDownsampleMode: mode === '4x' || mode === '16x' ? mode : undefined,
                  })
                }
              >
                <SelectTrigger
                  id="image_downsample_mode"
                  className="h-11 sm:h-8"
                  aria-describedby="image_downsample_mode_hint"
                >
                  <SelectValue placeholder={t('imageDownsampleUnset')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset" className="min-h-11 sm:min-h-8">
                    {t('imageDownsampleUnset')}
                  </SelectItem>
                  <SelectItem value="4x" className="min-h-11 sm:min-h-8">
                    4x
                  </SelectItem>
                  <SelectItem value="16x" className="min-h-11 sm:min-h-8">
                    16x
                  </SelectItem>
                </SelectContent>
              </Select>
              <p id="image_downsample_mode_hint" className="text-xs text-muted-foreground">
                {t('imageDownsampleHint')}
              </p>
            </div>
          )}

          {showReasoning && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="thinking_style">{t('thinkingStyle')}</Label>
              <Select
                value={params.thinkingStyle}
                onValueChange={(v) => onUpdate({ thinkingStyle: v as ThinkingStyle })}
              >
                <SelectTrigger id="thinking_style">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(styleLabels) as ThinkingStyle[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {styleLabels[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t('thinkingStyleHint')}</p>
            </div>
          )}

          <ToggleField
            label={t('streaming')}
            hint={params.webSearch ? t('webSearchStreamingHint') : t('streamingEnabledHint')}
            checked={params.webSearch ? true : params.stream}
            disabled={params.webSearch}
            onChange={(v) => onStreamChange(params.webSearch ? true : v)}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onReset}>
            {t('restoreDefaults')}
          </Button>
          <Button onClick={() => onOpenChange(false)}>{t('done')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Switch field: label + description + switch on the right (@map/ui has no Switch primitive yet; simulate it with a controlled button) */
function ToggleField({
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-1">
        <Label>{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60 ${
          checked ? 'bg-primary' : 'bg-muted'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}

/** Number input field with a description */
function NumberField({
  id,
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value?: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value ?? ''}
        onChange={(e) => {
          if (e.target.value === '') {
            onChange(undefined);
            return;
          }
          const next = Number(e.target.value);
          if (Number.isNaN(next)) return;
          onChange(Math.min(max, Math.max(min, next)));
        }}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
