/**
 * Reference-audio capture area (for voice cloning).
 *
 * Purpose: the three-state view of reference audio under the TTS "upload clone" voice —
 * 1) empty: two entries, upload a file / start recording;
 * 2) recording: a realtime voiceprint + seconds recorded + remaining hint, so the user can see whether they are making sound;
 * 3) ready: a waveform player for preview, with "record again" and "delete." Recording or uploading again overwrites the old audio directly.
 *
 * This component only renders from props. Recording orchestration is in useVoiceRecorder / useTtsSynthesis.
 */

import { Upload, Mic, Square, Trash2, RotateCcw } from 'lucide-react';
import { Button } from '@map/ui';
import { useTranslation } from 'react-i18next';
import { AudioWavePlayer } from './AudioWavePlayer';
import { TTS_REF_MAX_SECONDS } from '../../utils/ttsVoices';

interface ReferenceAudioFieldProps {
  /** Whether recording is in progress */
  recording: boolean;
  /** Realtime spectrum bars while recording (0–1) */
  bars: number[];
  /** Seconds already recorded */
  seconds: number;
  /** Data URI of the ready reference audio; undefined when nothing has been captured */
  referenceUrl?: string;
  /** Display name of the ready audio */
  referenceName?: string;
  /** Recording permission / duration error */
  error?: string;
  onStart: () => void;
  onStop: () => void;
  onClear: () => void;
  /** Choose a local file */
  onPickFile: (file: File) => void;
}

/**
 * Reference-audio capture area.
 * @param props State and callbacks needed by the three states
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

/** Realtime voiceprint while recording: spectrum bars mirrored around the center, degrading to a thin center line when silent (a hint that "no sound was received") */
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

/** Dashed upload area in the empty state */
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

/** "Upload again" button in the ready state (a label wrapping an input, to reuse the native file picker) */
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

/** Seconds → mm:ss */
function fmtSeconds(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
