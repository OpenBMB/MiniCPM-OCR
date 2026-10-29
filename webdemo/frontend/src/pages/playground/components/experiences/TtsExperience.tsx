/**
 * 体验中心「语音合成（TTS）」体验页。
 *
 * 用途：真实语音合成工作台——左侧文本输入与波形播放器结果，右侧合成设置（TtsSettingsPanel）。
 * 走 L2 `/v1/audio/speech`。音色三态：默认音色 / 预置示范音色 / 上传复刻（语音复刻，上传或录制
 * 参考音频克隆音色）；声音描述（Control Instruction）以文本前缀控制风格；输出支持 wav / mp3。本页为
 * 容器：装配 useTtsSynthesis 与视图，请求/状态编排收敛在 hook，设置控件收敛在 TtsSettingsPanel。
 */

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useToast } from '@map/ui';
import { useTranslation } from 'react-i18next';
import type { TtsFormat } from '@/api/map/audio';
import { useFeatureAccessQuery } from '@/api/map';
import type { usePlaygroundModel } from '../../hooks/usePlaygroundModel';
import { useTtsSynthesis, TTS_MAX_LEN } from '../../hooks/useTtsSynthesis';
import { AudioWavePlayer } from './AudioWavePlayer';
import { TtsSettingsPanel, type TtsMode } from './TtsSettingsPanel';
import { resolveTtsMode, VOICE_DEFAULT, VOICE_UPLOAD } from '../../utils/ttsVoices';

type PlaygroundModel = ReturnType<typeof usePlaygroundModel>;

/**
 * 语音合成体验页。
 * @param model 模型与密钥编排（来自页面顶层 usePlaygroundModel）
 */
export function TtsExperience({ model }: { model: PlaygroundModel }) {
  const { toast } = useToast();
  const { t } = useTranslation('playground');
  const [mode, setMode] = useState<TtsMode>('generate');
  const featureAccess = useFeatureAccessQuery();
  const canUseVoiceClone = featureAccess.data?.voice_clone === true;
  const effectiveMode = resolveTtsMode(mode, canUseVoiceClone);
  const tts = useTtsSynthesis(model, effectiveMode === 'clone');
  const samples = [t('ttsSample1'), t('ttsSample2'), t('ttsSample3')];

  useEffect(() => {
    if (mode !== 'clone' || canUseVoiceClone) return;
    setMode('generate');
    tts.setVoice(VOICE_DEFAULT);
  }, [canUseVoiceClone, mode, tts.setVoice]);

  function handleModeChange(nextMode: TtsMode) {
    if (nextMode === 'clone' && !canUseVoiceClone) return;
    setMode(nextMode);
    const hasSelectedSavedVoice = tts.savedVoices.some((voice) => voice.id === tts.voice);
    if (nextMode === 'clone' && !hasSelectedSavedVoice) {
      tts.setVoice(VOICE_UPLOAD);
    } else if (tts.voice === VOICE_UPLOAD || tts.voice.startsWith('voice_')) {
      tts.setVoice(VOICE_DEFAULT);
    }
  }

  // 上传参考音频：超 50s / 转码失败给出可读提示（不静默吞）
  async function onUpload(file: File) {
    try {
      await tts.uploadReference(file);
    } catch (e) {
      toast({
        title: t('referenceAudioUnavailable'),
        description: (e as Error).message || t('referenceAudioRetry'),
        variant: 'error',
      });
    }
  }

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-y-auto px-3 py-4 sm:px-4">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* 左：文本 + 结果 */}
        <div className="flex min-w-0 flex-col gap-4">
          <section className="flex flex-col rounded-2xl bg-card p-4 shadow-card sm:p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">
                {effectiveMode === 'clone' ? t('ttsCloneText') : t('ttsGenerateText')}
              </h2>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => tts.setText('')}
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  {t('clear')}
                </button>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {tts.text.length} / {TTS_MAX_LEN}
                </span>
              </div>
            </div>
            <textarea
              value={tts.text}
              maxLength={TTS_MAX_LEN}
              onChange={(e) => tts.setText(e.target.value)}
              placeholder={
                effectiveMode === 'clone' ? t('ttsClonePlaceholder') : t('ttsGeneratePlaceholder')
              }
              className="min-h-52 w-full resize-none rounded-xl bg-muted/40 p-3 text-sm leading-relaxed text-foreground outline-none ring-offset-background placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{t('examples')}</span>
              {samples.map((sample, i) => (
                <button
                  key={sample}
                  type="button"
                  onClick={() => tts.setText(sample)}
                  className="rounded-full bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {t('exampleNumber', { number: i + 1 })}
                </button>
              ))}
            </div>
          </section>

          <ResultCard
            audioUrl={tts.audioUrl}
            format={tts.audioFormat}
            loading={tts.loading}
            error={tts.error}
          />
        </div>

        {/* 右：合成设置 */}
        <TtsSettingsPanel
          model={model}
          tts={tts}
          mode={effectiveMode}
          canUseVoiceClone={canUseVoiceClone}
          onModeChange={handleModeChange}
          onUpload={onUpload}
        />
      </div>
    </div>
  );
}

/** 合成结果卡：加载 / 错误 / 播放器 / 空态四态。下载名跟随结果音频的实际格式 */
function ResultCard({
  audioUrl,
  format,
  loading,
  error,
}: {
  audioUrl?: string;
  format: TtsFormat;
  loading: boolean;
  error?: string;
}) {
  const { t } = useTranslation('playground');
  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-card p-4 shadow-card sm:p-5">
      <h2 className="text-sm font-semibold text-foreground">{t('synthesisResult')}</h2>

      {loading && (
        <div className="flex items-center gap-2 rounded-xl bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          {t('synthesizingSpeech')}
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl bg-destructive/10 px-4 py-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && audioUrl && (
        <AudioWavePlayer src={audioUrl} downloadName={`speech.${format}`} autoPlay />
      )}

      {!loading && !error && !audioUrl && (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-border/60 py-8 text-sm text-muted-foreground/60">
          {t('synthesisEmpty')}
        </div>
      )}
    </section>
  );
}
