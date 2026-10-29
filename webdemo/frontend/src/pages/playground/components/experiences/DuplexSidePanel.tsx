/**
 * Duplex right settings panel (grouped in Tabs).
 *
 * Purpose: the full parameters aligned with the MiniCPM-o demo — call (conversation mode/model/voice/system prompt/TTS switch), voice clone (reference-audio upload), advanced (Length Penalty/Max Tokens/Temperature/playback delay), devices (microphone/speaker). System prompt/voice/model/TTS switch actually take effect; sampling parameters are passed through upstream (they take effect when supported); reference audio does voice cloning; device switching is real. Icons use lucide-react. Pure display component.
 */

import { Activity, ChevronDown, RefreshCw, RotateCcw, Upload } from 'lucide-react';
import {
  Button,
  Card,
  Checkbox,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@map/ui';
import { useTranslation } from 'react-i18next';
import { isFreeModel } from '@/utils/modelExperience';
import { LimitedFreeTag } from '@/components/LimitedFreeTag';
import type { usePlaygroundModel } from '../../hooks/usePlaygroundModel';
import type { VoiceStatus } from '../../hooks/useRealtimeSession';
import type { DuplexLanguage, DuplexSettings, DuplexOption } from '../../hooks/useDuplexSettings';
import type { DeviceOption } from '../../hooks/useDevices';
import type { SessionMetrics } from '../../utils/realtimeSessionMetrics';
import { KeyStatusBar } from '../KeyStatusBar';
import { VoiceSelector } from './VoiceSelector';

type PlaygroundModel = ReturnType<typeof usePlaygroundModel>;

const TAB_CONTENT_CLASS =
  'mt-3 min-h-0 flex-1 overflow-y-auto overlay-scroll pr-1 data-[state=inactive]:hidden data-[state=active]:animate-[map-tab-content-in_160ms_ease-out] motion-reduce:animate-none';

interface DuplexSidePanelProps {
  model: PlaygroundModel;
  sources: DuplexOption[];
  voices: DuplexOption[];
  settings: DuplexSettings;
  patch: (p: Partial<DuplexSettings>) => void;
  onVoiceChange: (voice: string) => void;
  selectLanguage: (language: DuplexLanguage) => void;
  /** Switch conversation mode (open/close the camera in sync during a session) */
  onAudioSource: (v: string) => void;
  mics: DeviceOption[];
  speakers: DeviceOption[];
  onRefreshDevices: () => void;
  onReset: () => void;
  status: VoiceStatus;
  rounds: number;
  locked: boolean;
  metrics: SessionMetrics;
}

/**
 * Right settings panel.
 */
export function DuplexSidePanel(props: DuplexSidePanelProps) {
  const { t } = useTranslation('playground');
  const {
    model,
    sources,
    voices,
    settings: s,
    patch,
    onVoiceChange,
    selectLanguage,
    onAudioSource,
    mics,
    speakers,
    onRefreshDevices,
    onReset,
    status,
    rounds,
    locked,
    metrics,
  } = props;
  const micLabel = s.micDeviceId
    ? (mics.find((device) => device.id === s.micDeviceId)?.label ?? t('selectedMicrophone'))
    : t('systemDefault');
  const speakerLabel = s.speakerDeviceId
    ? (speakers.find((device) => device.id === s.speakerDeviceId)?.label ?? t('selectedSpeaker'))
    : t('systemDefault');
  const statusLabels: Record<VoiceStatus, string> = {
    idle: t('callIdle'),
    requesting: t('connecting'),
    listening: t('listening'),
    processing: t('thinking'),
    speaking: t('modelSpeaking'),
    denied: t('callDenied'),
    error: t('callError'),
  };

  return (
    <aside className="flex h-auto min-h-0 flex-col gap-3 overflow-hidden rounded-2xl bg-card p-4 shadow-card lg:h-full">
      <Tabs defaultValue="call" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TabsList className="w-full shrink-0">
          <TabsTrigger value="call" className="flex-1">
            {t('call')}
          </TabsTrigger>
          <TabsTrigger value="advanced" className="flex-1">
            {t('advanced')}
          </TabsTrigger>
          <TabsTrigger value="device" className="flex-1">
            {t('devices')}
          </TabsTrigger>
        </TabsList>

        {/* Call */}
        <TabsContent forceMount value="call" className={`${TAB_CONTENT_CLASS} flex flex-col gap-4`}>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-xs font-medium text-muted-foreground">
              {t('conversationMode')}
            </legend>
            <div className="grid grid-cols-2 gap-1.5">
              {sources.map((o) => (
                <SegBtn
                  key={o.value}
                  active={s.audioSource === o.value}
                  disabled={locked}
                  onClick={() => onAudioSource(o.value)}
                >
                  {t(o.label)}
                </SegBtn>
              ))}
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-xs font-medium text-muted-foreground">{t('language')}</legend>
            <div className="grid grid-cols-2 gap-1.5">
              <SegBtn
                active={s.language === 'zh'}
                disabled={locked}
                onClick={() => selectLanguage('zh')}
              >
                {t('languageChinese')}
              </SegBtn>
              <SegBtn
                active={s.language === 'en'}
                disabled={locked}
                onClick={() => selectLanguage('en')}
              >
                {t('languageEnglish')}
              </SegBtn>
            </div>
          </fieldset>
          <Field label={t('selectModel')}>
            {/* Candidates come from models the admin console marked with the realtime capability; the model cannot be changed during a call (locked) */}
            <SimpleSelect
              value={model.realtimeModel?.id ?? ''}
              onChange={model.selectRealtimeModel}
              disabled={locked || model.realtimeModels.length === 0}
              placeholder={model.modelsLoading ? t('modelsLoading') : t('noModels')}
            >
              {model.realtimeModels.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.display_name || m.id}
                  {m.parameter_count && (
                    <span className="ml-2 text-xs text-muted-foreground">{m.parameter_count}</span>
                  )}
                  {isFreeModel(m) && <LimitedFreeTag className="ml-2 align-middle" />}
                </SelectItem>
              ))}
            </SimpleSelect>
          </Field>
          <Field label={t('voice')}>
            <VoiceSelector
              value={s.voice}
              onChange={onVoiceChange}
              presetOptions={voices.map((voice) => ({
                value: voice.value,
                label: t(voice.label),
                searchText: voice.value,
              }))}
              savedVoices={[]}
              allowSavedVoices={false}
              disabled={locked}
              ariaLabel={t('voice')}
              searchPlaceholder={t('voiceSearchPlaceholder')}
              presetGroupLabel={t('presetVoices')}
              savedGroupLabel={t('myVoices')}
              noResultsLabel={t('voiceSearchEmpty')}
            />
          </Field>
          <Field label={t('systemPrompt')}>
            <Textarea
              value={s.system}
              onChange={(e) => patch({ system: e.target.value })}
              rows={3}
              className="min-h-20 resize-none text-xs leading-relaxed"
            />
          </Field>
          <AudioReferenceField
            label={t('llmReferenceAudio')}
            name={s.refAudioName}
            onChange={(base64, name) => patch({ refAudio: base64, refAudioName: name })}
          />
          <AudioReferenceField
            label={t('ttsReferenceAudio')}
            name={s.ttsRefAudioName}
            onChange={(base64, name) => patch({ ttsRefAudio: base64, ttsRefAudioName: name })}
          />
          <label className="flex items-center gap-2 text-xs text-foreground">
            <Checkbox
              checked={s.ttsEnabled}
              onChange={(e) =>
                patch({ ttsEnabled: e.target.checked, outputAudio: e.target.checked })
              }
            />
            {t('ttsResponse')}
          </label>
          <label className="flex items-center gap-2 text-xs text-foreground">
            <Checkbox
              checked={s.visionHD}
              onChange={(e) => patch({ visionHD: e.target.checked })}
            />
            {t('highDefinitionVision')}
          </label>
        </TabsContent>

        {/* Advanced */}
        <TabsContent
          forceMount
          value="advanced"
          className={`${TAB_CONTENT_CLASS} flex flex-col gap-3`}
        >
          <SettingsSection title={t('session')} defaultOpen>
            <NumberFieldGroup>
              <NumberField
                layout="subgrid"
                label={t('playbackDelay')}
                value={s.playbackDelay}
                min={0}
                max={2000}
                step={50}
                suffix="ms"
                disabled={locked}
                onChange={(v) => patch({ playbackDelay: v })}
              />
              <NumberField
                layout="subgrid"
                label={t('maxKv')}
                value={s.maxKvTokens}
                min={512}
                max={8192}
                step={512}
                suffix="tok"
                disabled={locked}
                onChange={(v) => patch({ maxKvTokens: v })}
              />
              <NumberField
                layout="subgrid"
                label={t('lengthPenalty')}
                value={s.lengthPenalty}
                min={0.5}
                max={2}
                step={0.05}
                disabled={locked}
                onChange={(v) => patch({ lengthPenalty: v })}
              />
            </NumberFieldGroup>
            <label className="flex items-center gap-2 text-xs text-foreground">
              <Checkbox
                checked={s.ttsEnabled}
                onChange={(e) =>
                  patch({ ttsEnabled: e.target.checked, outputAudio: e.target.checked })
                }
              />
              {t('ttsResponse')}
            </label>
          </SettingsSection>
          <SettingsSection title={t('responseLength')} defaultOpen>
            <div className="flex items-center gap-2 text-xs">
              <span className="shrink-0 font-medium text-muted-foreground">
                {t('lengthPenalty')}
              </span>
              <span className="font-mono tabular-nums text-foreground">
                {s.lengthPenalty.toFixed(2)}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <PresetButton
                active={s.responseLengthPreset === 'detail'}
                onClick={() => patch({ responseLengthPreset: 'detail', lengthPenalty: 1.2 })}
              >
                {t('detailed')}
              </PresetButton>
              <PresetButton
                active={s.responseLengthPreset === 'balanced'}
                onClick={() => patch({ responseLengthPreset: 'balanced', lengthPenalty: 1.05 })}
              >
                {t('balanced')}
              </PresetButton>
              <PresetButton
                active={s.responseLengthPreset === 'concise'}
                onClick={() => patch({ responseLengthPreset: 'concise', lengthPenalty: 0.9 })}
              >
                {t('concise')}
              </PresetButton>
            </div>
            <p className="text-[11px] text-muted-foreground/70">{t('responseLengthHint')}</p>
          </SettingsSection>
          <SettingsSection title={t('visualSettings')} defaultOpen>
            <label className="flex items-center justify-between gap-2 text-xs text-foreground">
              <span>{t('highDefinitionVision')}</span>
              <span className="flex items-center gap-2">
                <Checkbox
                  checked={s.visionHD}
                  onChange={(e) => patch({ visionHD: e.target.checked })}
                />
                <span className="text-muted-foreground">64 tok</span>
              </span>
            </label>
          </SettingsSection>
          <SettingsSection title={t('otherSettings')} defaultOpen>
            <NumberField
              label={t('maxResponseTokens')}
              value={s.maxTokens}
              min={128}
              max={4096}
              step={128}
              suffix="tok"
              disabled={locked}
              onChange={(v) => patch({ maxTokens: v })}
            />
            <RangeField
              label={t('temperature')}
              value={s.temperature}
              min={0}
              max={1.5}
              step={0.05}
              onChange={(v) => patch({ temperature: v })}
            />
          </SettingsSection>
          <SettingsSection title={t('fullscreenSubtitles')} defaultOpen>
            <NumberField
              label={t('height')}
              value={s.subtitleHeightPercent}
              min={5}
              max={80}
              step={5}
              suffix="% from bottom"
              disabled={locked}
              onChange={(v) => patch({ subtitleHeightPercent: v })}
            />
            <div className="flex flex-col gap-3">
              <NumberField
                label={t('bottomOpacity')}
                value={s.subtitleBottomOpacity}
                min={0}
                max={100}
                step={5}
                suffix="%"
                disabled={locked}
                onChange={(v) => patch({ subtitleBottomOpacity: v })}
              />
              <NumberField
                label={t('topOpacity')}
                value={s.subtitleTopOpacity}
                min={0}
                max={100}
                step={5}
                suffix="%"
                disabled={locked}
                onChange={(v) => patch({ subtitleTopOpacity: v })}
              />
            </div>
          </SettingsSection>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onReset}
            title={t('restoreRealtimeDefaults')}
            className="self-start gap-1.5 px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            {t('restoreDefaultConfiguration')}
          </Button>
        </TabsContent>

        {/* Devices */}
        <TabsContent
          forceMount
          value="device"
          className={`${TAB_CONTENT_CLASS} flex flex-col gap-3`}
        >
          <SettingsSection title={t('audioDevices')} defaultOpen>
            <Field label={t('microphone')}>
              <SimpleSelect
                value={s.micDeviceId || 'default'}
                displayValue={micLabel}
                onChange={(v) => patch({ micDeviceId: v === 'default' ? '' : v })}
                disabled={locked}
              >
                <SelectItem value="default">{t('systemDefault')}</SelectItem>
                {mics.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.label}
                  </SelectItem>
                ))}
              </SimpleSelect>
            </Field>
            <Field label={t('speaker')}>
              <SimpleSelect
                value={s.speakerDeviceId || 'default'}
                displayValue={speakerLabel}
                onChange={(v) => patch({ speakerDeviceId: v === 'default' ? '' : v })}
              >
                <SelectItem value="default">{t('systemDefault')}</SelectItem>
                {speakers.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.label}
                  </SelectItem>
                ))}
              </SimpleSelect>
            </Field>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRefreshDevices}
              title={t('refreshDevices')}
              className="w-full gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t('refresh')}
            </Button>
          </SettingsSection>
          <SettingsSection title={t('fullscreenSubtitles')} defaultOpen>
            <NumberField
              label={t('height')}
              value={s.subtitleHeightPercent}
              min={5}
              max={80}
              step={5}
              suffix="% from bottom"
              disabled={locked}
              onChange={(v) => patch({ subtitleHeightPercent: v })}
            />
            <div className="flex flex-col gap-3">
              <NumberField
                label={t('bottomOpacity')}
                value={s.subtitleBottomOpacity}
                min={0}
                max={100}
                step={5}
                suffix="%"
                disabled={locked}
                onChange={(v) => patch({ subtitleBottomOpacity: v })}
              />
              <NumberField
                label={t('topOpacity')}
                value={s.subtitleTopOpacity}
                min={0}
                max={100}
                step={5}
                suffix="%"
                disabled={locked}
                onChange={(v) => patch({ subtitleTopOpacity: v })}
              />
            </div>
          </SettingsSection>
        </TabsContent>
      </Tabs>

      <KeyStatusBar
        loading={model.keysLoading}
        hasKeys={model.hasKeys}
        secretLoading={model.secretLoading}
        secretError={model.secretError}
        trialRemaining={model.trialRemaining.realtime}
        trialError={model.trialError}
      />

      <details className="group mt-auto shrink-0 border-t border-border/60 pt-3 text-xs">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
          <Activity className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{t('metrics')}</span>
          <ChevronDown
            className="ml-auto h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="mt-3 flex flex-col gap-1.5">
          <Row k={t('state')} v={statusLabels[status]} />
          <Row k="SID" v={metrics.sessionId} />
          <Row k={t('rounds')} v={String(rounds)} />
          <Row k={t('metricChunks')} v={String(metrics.chunks)} />
          <Row k={t('metricKv')} v={String(metrics.kv)} />
          <Row k={t('metricVision')} v={String(metrics.vision)} />
          <Row k={t('metricInfer')} v={String(metrics.infer)} />
          <Row
            k={t('metricTtfs')}
            v={metrics.ttfsMs == null ? '-' : String(metrics.ttfsMs) + 'ms'}
          />
          <Row k={t('metricPlaybackDelay')} v={String(metrics.playbackDelayMs) + 'ms'} />
          <Row k={t('metricAhead')} v={String(metrics.aheadMs) + 'ms'} />
          <Row k={t('metricShift')} v={String(metrics.shiftMs)} />
          <Row k={t('metricDrift')} v={String(metrics.driftMs)} />
        </div>
      </details>
    </aside>
  );
}

function SettingsSection({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <details open={defaultOpen}>
        <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-semibold text-foreground">
          {title}
        </summary>
        <div className="flex flex-col gap-3 border-t border-border/50 px-3 py-3">{children}</div>
      </details>
    </Card>
  );
}

function PresetButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={active ? 'default' : 'outline'}
      size="sm"
      onClick={onClick}
      className="rounded-full"
    >
      {children}
    </Button>
  );
}

/** Let number fields in the same group share three columns: label, input, and unit. */
function NumberFieldGroup({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-number-field-group
      className="grid min-w-0 grid-cols-[minmax(0,1fr)_5rem_auto] items-center gap-x-2 gap-y-3"
    >
      {children}
    </div>
  );
}

function NumberField({
  layout = 'standalone',
  label,
  value,
  min,
  max,
  step,
  suffix,
  disabled,
  onChange,
}: {
  layout?: 'standalone' | 'subgrid';
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const rowClassName =
    layout === 'subgrid'
      ? 'col-span-3 grid min-w-0 grid-cols-subgrid items-center gap-2 text-xs'
      : 'grid min-w-0 grid-cols-[minmax(0,1fr)_5rem_auto] items-center gap-2 text-xs';

  return (
    <label className={rowClassName}>
      <span className="min-w-0 font-medium leading-tight text-muted-foreground">{label}</span>
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full text-center font-mono"
      />
      {suffix && <span className="whitespace-nowrap text-muted-foreground">{suffix}</span>}
    </label>
  );
}

function AudioReferenceField({
  label,
  name,
  onChange,
}: {
  label: string;
  name?: string;
  onChange: (base64: string, name: string) => void;
}) {
  const { t } = useTranslation('playground');
  const inputId = `duplex-audio-reference-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5">
        <Upload className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {name ? t('selectedFile', { name }) : t('noFileSelected')}
        </span>
        <label
          htmlFor={inputId}
          className="shrink-0 cursor-pointer rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          {t('chooseFile')}
        </label>
        <Input
          id={inputId}
          type="file"
          accept="audio/*"
          aria-label={label}
          className="!absolute !m-[-1px] !h-px !w-px !overflow-hidden !p-0 !border-0 !whitespace-nowrap ![clip:rect(0,0,0,0)]"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
              const value = String(reader.result || '');
              const comma = value.indexOf(',');
              onChange(comma >= 0 ? value.slice(comma + 1) : value, file.name);
            };
            reader.readAsDataURL(file);
          }}
        />
      </div>
    </div>
  );
}

/** Field container */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** Segmented button */
function SegBtn({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={active ? 'default' : 'outline'}
      size="sm"
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className="w-full"
    >
      {children}
    </Button>
  );
}

/** Slim Select wrapper. placeholder is the stand-in when there are no candidates or nothing is selected (when omitted, keep Radix's empty state) */
function SimpleSelect({
  value,
  onChange,
  disabled,
  placeholder,
  displayValue,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  displayValue?: string;
  children: React.ReactNode;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="h-9">
        <SelectValue placeholder={placeholder}>{displayValue}</SelectValue>
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}

/** Slider field */
function RangeField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="text-xs tabular-nums text-foreground">
          {value}
          {suffix ? ` ${suffix}` : ''}
        </span>
      </div>
      <Input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="h-1.5 cursor-pointer appearance-none border-0 bg-muted p-0 accent-primary"
      />
    </div>
  );
}

/** Status row */
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium text-foreground">{v}</span>
    </div>
  );
}
