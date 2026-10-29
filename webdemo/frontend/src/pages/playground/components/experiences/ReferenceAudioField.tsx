/**
 * 参考音频采集区（语音复刻用）。
 *
 * 用途：TTS「上传复刻」音色下的参考音频三态视图——
 * 1) 空态：上传文件 / 开始录音两个入口；
 * 2) 录制中：实时声纹 + 已录秒数 + 剩余提示，用户看得见自己有没有出声；
 * 3) 已就绪：波形播放器可试听，配「重新录制」与「删除」。重录/重传直接覆盖旧音频。
 *
 * 本组件只吃 props 渲染，录音编排在 useVoiceRecorder / useTtsSynthesis。
 */

import { Upload, Mic, Square, Trash2, RotateCcw } from 'lucide-react';
import { Button } from '@map/ui';
import { useTranslation } from 'react-i18next';
import { AudioWavePlayer } from './AudioWavePlayer';
import { TTS_REF_MAX_SECONDS } from '../../utils/ttsVoices';

interface ReferenceAudioFieldProps {
  /** 是否录制中 */
  recording: boolean;
  /** 录制中的实时频谱条（0–1） */
  bars: number[];
  /** 已录秒数 */
  seconds: number;
  /** 已就绪的参考音频 data URI，未采集时 undefined */
  referenceUrl?: string;
  /** 已就绪音频的展示名 */
  referenceName?: string;
  /** 录音权限 / 时长错误 */
  error?: string;
  onStart: () => void;
  onStop: () => void;
  onClear: () => void;
  /** 选择本地文件 */
  onPickFile: (file: File) => void;
}

/**
 * 参考音频采集区。
 * @param props 三态所需的状态与回调
 */
export function ReferenceAudioField({
  recording,
  bars,
  seconds,
  referenceUrl,
  referenceName,
  error,
  onStart,
  onStop,
  onClear,
  onPickFile,
}: ReferenceAudioFieldProps) {
  const { t } = useTranslation('playground');
  const remaining = Math.max(0, TTS_REF_MAX_SECONDS - seconds);

  if (recording) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-primary/40 bg-primary/[0.03] p-3">
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 font-medium text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary motion-safe:animate-pulse" />
            {t('recording')}
          </span>
          <span className="tabular-nums text-muted-foreground">
            {fmtSeconds(seconds)} · {t('remaining', { seconds: remaining })}
          </span>
        </div>
        <LiveWave bars={bars} />
        <Button type="button" variant="destructive" className="w-full gap-2" onClick={onStop}>
          <Square className="h-4 w-4" />
          {t('stopAndSave')}
        </Button>
      </div>
    );
  }

  if (referenceUrl) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-muted/20 p-3">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="truncate font-medium text-foreground">
            {referenceName || t('referenceAudio')}
          </span>
          <button
            type="button"
            onClick={onClear}
            className="flex shrink-0 items-center gap-1 text-destructive transition-colors hover:text-destructive/80"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('deleteReference')}
          </button>
        </div>
        <AudioWavePlayer src={referenceUrl} downloadName={referenceName || 'reference.wav'} />
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1 gap-1.5"
            onClick={onStart}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t('reRecord')}
          </Button>
          <FilePickButton label={t('reUpload')} onPick={onPickFile} />
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <FilePickLabel onPick={onPickFile} />
      <Button type="button" variant="outline" className="w-full gap-2" onClick={onStart}>
        <Mic className="h-4 w-4" />
        {t('recordReference')}
      </Button>
      <p className="min-h-[1.25rem] text-xs text-muted-foreground/60">
        {error ? (
          <span className="text-destructive">{error}</span>
        ) : (
          t('referenceAudioHint', { seconds: TTS_REF_MAX_SECONDS })
        )}
      </p>
    </div>
  );
}

/** 录音中的实时声纹：频谱条居中镜像，静音时退化为一条细中线（提示"没收到声音"） */
function LiveWave({ bars }: { bars: number[] }) {
  const { t } = useTranslation('playground');
  const silent = bars.length === 0 || bars.every((b) => b < 0.02);
  return (
    <div
      className="flex h-10 items-center justify-between gap-[2px] rounded-lg bg-background px-2"
      aria-label={t('recordingVolume')}
    >
      {silent ? (
        <span className="h-[2px] w-full rounded-full bg-muted-foreground/25" />
      ) : (
        bars.map((h, i) => (
          <span
            key={i}
            style={{ height: `${Math.max(8, h * 100)}%` }}
            className="w-[3px] shrink-0 rounded-full bg-primary"
          />
        ))
      )}
    </div>
  );
}

/** 空态的虚线上传区 */
function FilePickLabel({ onPick }: { onPick: (file: File) => void }) {
  const { t } = useTranslation('playground');
  return (
    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border py-5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
      <Upload className="h-4 w-4 shrink-0" />
      <span className="truncate">{t('selectReferenceAudio')}</span>
      <input
        type="file"
        accept="audio/*"
        className="absolute h-px w-px overflow-hidden border-0 p-0 opacity-0"
        onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])}
      />
    </label>
  );
}

/** 已就绪态的「重新上传」按钮（label 包 input 以复用原生文件选择） */
function FilePickButton({ label, onPick }: { label: string; onPick: (file: File) => void }) {
  return (
    <label className="flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted">
      <Upload className="h-3.5 w-3.5" />
      {label}
      <input
        type="file"
        accept="audio/*"
        className="absolute h-px w-px overflow-hidden border-0 p-0 opacity-0"
        onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])}
      />
    </label>
  );
}

/** 秒 → mm:ss */
function fmtSeconds(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
