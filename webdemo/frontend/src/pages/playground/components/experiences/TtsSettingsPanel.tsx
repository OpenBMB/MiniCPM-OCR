/**
 * 语音合成「合成设置」面板。
 *
 * 用途：TtsExperience 右栏设置的展示组件——模型（只读锁定）、声音描述（预设下拉 + 自定义展开
 * + 查看示例）、音色（默认/预置/上传复刻）、上传或录制参考音频、高级设置
 * （CFG 引导强度滑块 + 参考音频降噪 / 文本规范化开关）、合成按钮与密钥状态。逻辑全在 useTtsSynthesis，
 * 本组件只吃 props 渲染，不含请求/状态编排。响应式：随外层栅格在窄屏堆叠，控件均全宽自适应。
 */

import { AudioLines, Loader2, Sparkles, SlidersHorizontal, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Switch,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@map/ui';
import type { usePlaygroundModel } from '../../hooks/usePlaygroundModel';
import type { MapModel } from '@/api/map';
import type { useTtsSynthesis } from '../../hooks/useTtsSynthesis';
import {
  VOICE_UPLOAD,
  TTS_CFG_MIN,
  TTS_CFG_MAX,
  TTS_CFG_STEP,
  TTS_CONTROL_PRESETS,
  TTS_CONTROL_EXAMPLES,
  resolveTtsMode,
  ttsVoicesForMode,
} from '../../hooks/useTtsSynthesis';
import { KeyStatusBar } from '../KeyStatusBar';
import { ReferenceAudioField } from './ReferenceAudioField';
import { VoiceSelector } from './VoiceSelector';
import { isFreeModel } from '@/utils/modelExperience';
import { LimitedFreeTag } from '@/components/LimitedFreeTag';

type PlaygroundModel = ReturnType<typeof usePlaygroundModel>;
type TtsState = ReturnType<typeof useTtsSynthesis>;
export type TtsMode = 'generate' | 'clone';

interface TtsSettingsPanelProps {
  model: PlaygroundModel;
  tts: TtsState;
  mode: TtsMode;
  /** 当前用户是否可使用语音复刻；未授权时只展示普通语音生成。 */
  canUseVoiceClone: boolean;
  onModeChange: (mode: TtsMode) => void;
  /** 上传参考音频（含错误 toast） */
  onUpload: (file: File) => void;
}

/**
 * 合成设置面板。
 * @param model 模型与密钥编排
 * @param tts useTtsSynthesis 返回的状态与动作
 * @param onUpload 参考音频上传处理
 */
export function TtsSettingsPanel({
  model,
  tts,
  mode,
  canUseVoiceClone,
  onModeChange,
  onUpload,
}: TtsSettingsPanelProps) {
  const { t } = useTranslation('playground');
  const effectiveMode = resolveTtsMode(mode, canUseVoiceClone);
  const isClone = effectiveMode === 'clone';
  const voiceOptions = ttsVoicesForMode(effectiveMode, canUseVoiceClone).map((voice) => ({
    value: voice.value,
    label: t(voice.label),
    searchText: voice.value,
  }));
  const actionLabel = tts.loading
    ? t('processing')
    : getTtsActionLabel(isClone, t('cloneAndGenerate'), t('generateAndPlay'));

  return (
    <aside className="flex h-full flex-col gap-4 rounded-2xl bg-card p-4 shadow-card sm:p-5">
      <Tabs value={effectiveMode} onValueChange={(value) => onModeChange(value as TtsMode)}>
        <TabsList className="w-full">
          <TabsTrigger value="generate" className="flex-1">
            {t('ttsGenerate')}
          </TabsTrigger>
          {canUseVoiceClone && (
            <TabsTrigger value="clone" className="flex-1">
              {t('ttsClone')}
            </TabsTrigger>
          )}
        </TabsList>
      </Tabs>

      <h2 className="text-sm font-semibold text-foreground">
        {isClone ? t('cloneSettings') : t('generateSettings')}
      </h2>

      <Field label={t('selectModel')}>
        <ExperienceModelSelect
          models={model.ttsModels}
          value={model.ttsModel?.id}
          onChange={model.selectTtsModel}
          loading={model.modelsLoading}
        />
      </Field>

      {isClone ? (
        <div className="flex flex-col gap-1.5">
          <Field label={t('voice')}>
            <VoiceSelector
              value={tts.voice}
              onChange={tts.setVoice}
              presetOptions={voiceOptions}
              savedVoices={tts.savedVoices}
              allowSavedVoices
              loading={tts.savedVoicesLoading}
              ariaLabel={t('voice')}
              searchPlaceholder={t('voiceSearchPlaceholder')}
              presetGroupLabel={t('presetVoices')}
              savedGroupLabel={t('myVoices')}
              noResultsLabel={t('voiceSearchEmpty')}
            />
            {tts.savedVoicesError && tts.voice.startsWith('voice_') && (
              <p className="text-xs text-destructive">{t('voiceListUnavailable')}</p>
            )}
          </Field>
          <span className="text-xs font-medium text-muted-foreground">{t('referenceAudio')}</span>
          {tts.voice === VOICE_UPLOAD ? (
            <ReferenceAudioField
              recording={tts.recording}
              bars={tts.recordBars}
              seconds={tts.recordSeconds}
              referenceUrl={tts.referenceUrl}
              referenceName={tts.uploadName}
              error={tts.recordError}
              onStart={tts.startRecording}
              onStop={tts.stopRecording}
              onClear={tts.clearReference}
              onPickFile={onUpload}
            />
          ) : (
            <p className="rounded-xl bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              {t('savedVoiceReferenceHint')}
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {t('voiceDescription')}
              </span>
              <ExamplesDialog />
            </div>
            <Select value={tts.controlPreset} onValueChange={tts.selectControlPreset}>
              <SelectTrigger className="h-9" aria-label={t('voiceDescriptionPreset')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TTS_CONTROL_PRESETS.map((p) => (
                  <SelectItem key={p.value || 'none'} value={p.value}>
                    {t(p.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {tts.isCustomControl && (
            <textarea
              value={tts.control}
              onChange={(e) => tts.setControl(e.target.value)}
              rows={2}
              placeholder={t('voiceDescriptionPlaceholder')}
              className="w-full resize-none rounded-xl bg-muted/40 p-2.5 text-sm leading-relaxed text-foreground outline-none ring-offset-background placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring"
            />
          )}

          <Field label={t('voice')}>
            <VoiceSelector
              value={tts.voice}
              onChange={tts.setVoice}
              presetOptions={voiceOptions}
              savedVoices={[]}
              allowSavedVoices={false}
              ariaLabel={t('voice')}
              searchPlaceholder={t('voiceSearchPlaceholder')}
              presetGroupLabel={t('presetVoices')}
              savedGroupLabel={t('myVoices')}
              noResultsLabel={t('voiceSearchEmpty')}
            />
          </Field>
        </>
      )}

      <AdvancedSettings tts={tts} isClone={isClone} />

      {isClone && (
        <p className="rounded-xl bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          {t('cloningHint')}
        </p>
      )}
      {/* 暂时隐藏生成模式说明，避免与当前简化的设置面板重复。 */}

      <Button
        className="mt-auto w-full gap-2"
        disabled={!tts.canSynthesize}
        onClick={tts.synthesize}
      >
        {tts.loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <AudioLines className="h-4 w-4" />
        )}
        {actionLabel}
      </Button>
      <KeyStatusBar
        loading={model.keysLoading}
        hasKeys={model.hasKeys}
        secretLoading={model.secretLoading}
        secretError={model.secretError}
        trialRemaining={model.trialRemaining.tts}
        trialError={model.trialError}
      />
    </aside>
  );
}

function getTtsActionLabel(isClone: boolean, cloneLabel: string, generateLabel: string): string {
  return isClone ? cloneLabel : generateLabel;
}

/** 高级设置：CFG 引导强度滑块 + 参考音频降噪 / 文本规范化开关（后二者透传上游） */
function AdvancedSettings({ tts, isClone }: { tts: TtsState; isClone: boolean }) {
  const { t } = useTranslation('playground');
  return (
    <details className="group rounded-xl border border-border/50 bg-muted/20 px-3 py-2">
      <summary className="flex cursor-pointer select-none list-none items-center gap-2 text-xs font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
        <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
        {t('advancedSettings')}
        <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="mt-3 flex flex-col gap-4">
        {/* CFG 引导强度：滑块直观调参，右侧同步数值 */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">{t('cfgGuidance')}</span>
            <span className="text-xs tabular-nums text-foreground">{tts.cfg.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min={TTS_CFG_MIN}
            max={TTS_CFG_MAX}
            step={TTS_CFG_STEP}
            value={tts.cfg}
            onChange={(e) => tts.setCfg(Number(e.target.value))}
            aria-label={t('cfgGuidance')}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground/70">{t('cfgHint')}</p>
        </div>

        {/* 透传开关：官方为 demo 侧预处理，我方作字段透传，生效取决于上游 LIS 能力 */}
        {isClone && (
          <ToggleRow
            label={t('referenceDenoise')}
            hint={t('upstreamSupported')}
            checked={tts.denoise}
            onChange={tts.setDenoise}
          />
        )}
        {/* 暂时隐藏文本规范化：当前上游能力未稳定提供，保留状态与透传逻辑以便恢复。 */}
      </div>
    </details>
  );
}

/** 开关行：标题 + 「上游支持时生效」诚实标注 + Switch */
function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex flex-col">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className="text-[11px] text-muted-foreground/70">{hint}</span>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

/** 「查看示例」弹窗：对齐官方 demo 的角色扮演 + 方言生成指南，给声音描述灵感 */
function ExamplesDialog() {
  const { t } = useTranslation('playground');
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 text-xs font-normal text-primary transition-colors hover:text-primary/80"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {t('viewExamples')}
        </button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[80vh] overflow-y-auto sm:max-w-lg"
        onClose={() => setOpen(false)}
      >
        <DialogHeader>
          <DialogTitle>{t('voiceDescriptionExamples')}</DialogTitle>
          <DialogDescription>{t('voiceDescriptionExamplesDescription')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {TTS_CONTROL_EXAMPLES.map((ex) => (
            <div key={ex.title} className="rounded-xl border border-border/50 bg-muted/20 p-3">
              <p className="text-sm font-semibold text-foreground">{t(ex.title)}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                <span className="text-muted-foreground/60">{t('descriptionLabel')}</span>
                {ex.control}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-foreground">
                <span className="text-muted-foreground/60">{t('promptLabel')}</span>
                {ex.targetText}
              </p>
              {ex.wrongText && (
                <p className="mt-1 text-xs leading-relaxed text-destructive/80">
                  <span className="text-destructive/60">{t('avoidMandarin')}</span>
                  {ex.wrongText}
                </p>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 带标题的表单字段容器 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** 只读锁定模型下拉：仅一个选项并默认选中，保持下拉外观但不提供切换 */
/**
 * 语音合成模型下拉：候选来自管理端勾了「语音合成」能力的全部模型。
 * 只有一个候选时下拉照常可用（仅一项），无候选时禁用并显示「暂无可用模型」。
 */
function ExperienceModelSelect({
  models,
  value,
  onChange,
  loading,
}: {
  models: MapModel[];
  value?: string;
  onChange: (id: string) => void;
  loading: boolean;
}) {
  const { t } = useTranslation('playground');
  const empty = models.length === 0;
  return (
    <Select value={value ?? ''} onValueChange={onChange} disabled={loading || empty}>
      <SelectTrigger className="h-9" aria-label={t('ttsModel')}>
        <SelectValue placeholder={loading ? t('modelsLoading') : t('noModels')} />
      </SelectTrigger>
      <SelectContent>
        {models.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.display_name || m.id}
            {m.parameter_count && (
              <span className="ml-2 text-xs text-muted-foreground">{m.parameter_count}</span>
            )}
            {isFreeModel(m) && <LimitedFreeTag className="ml-2 align-middle" />}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
