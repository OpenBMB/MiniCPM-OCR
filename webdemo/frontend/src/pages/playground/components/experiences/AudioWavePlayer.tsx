/**
 * 语音波形播放器。
 *
 * 用途：为合成/回复音频提供紧凑的自定义播放器——播放/暂停、可点击 seek 的波形进度、
 * 时间、倍速、下载，单行排布。波形取自音频真实峰值（解码一次高分辨率，再按容器宽度
 * 重采样），细条居中镜像，随播放进度高亮；解码失败时退化为一条中线，不影响播放。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { decodeWaveformPeaks } from '../../utils/audioEncode';

interface AudioWavePlayerProps {
  /** 音频 Object URL */
  src: string;
  /** 下载文件名 */
  downloadName?: string;
  /** 音频就绪后尝试自动播放；播放被浏览器拦截时保留手动播放入口 */
  autoPlay?: boolean;
}

/** 解码分辨率：一次解够，之后按容器宽度重采样，避免缩放时反复解码 */
const PEAK_RESOLUTION = 1024;
/** 单条占位（条宽 2px + 间隙 2px），用于按容器宽度推算条数 */
const BAR_PITCH = 4;

/**
 * 波形播放器。
 * @param src 音频 URL
 * @param downloadName 下载文件名
 * @param autoPlay 是否在音频就绪后尝试自动播放
 */
export function AudioWavePlayer({
  src,
  downloadName = 'audio.wav',
  autoPlay = false,
}: AudioWavePlayerProps) {
  const { t } = useTranslation('playground');
  const audioRef = useRef<HTMLAudioElement>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const autoPlayAttemptedFor = useRef<string | undefined>(undefined);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [decoded, setDecoded] = useState<{ src: string; peaks: number[] | null }>({
    src: '',
    peaks: null,
  });
  const [barCount, setBarCount] = useState(80);
  const [autoPlayBlocked, setAutoPlayBlocked] = useState(false);

  const progress = duration > 0 ? current / duration : 0;
  // 结果带 src 存放：src 切换后自动视为“未解码”，无需在 effect 里同步重置
  const peaks = decoded.src === src ? decoded.peaks : null;

  // 解码真实波形（每个 src 一次）
  useEffect(() => {
    let alive = true;
    decodeWaveformPeaks(src, PEAK_RESOLUTION).then((p) => {
      if (alive) setDecoded({ src, peaks: p });
    });
    return () => {
      alive = false;
    };
  }, [src]);

  // 条数跟随容器宽度，窄屏自动变稀，避免固定条数被挤成胖块
  useEffect(() => {
    const el = waveRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => {
      setBarCount(Math.max(24, Math.min(320, Math.floor(entry.contentRect.width / BAR_PITCH))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bars = useMemo(() => (peaks ? resample(peaks, barCount) : null), [peaks, barCount]);

  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
    } else {
      el.play().catch(() => undefined);
    }
  }

  function tryAutoPlay() {
    const el = audioRef.current;
    if (!autoPlay || !el || autoPlayAttemptedFor.current === src) return;
    autoPlayAttemptedFor.current = src;
    void el.play().catch(() => setAutoPlayBlocked(true));
  }

  useEffect(() => {
    autoPlayAttemptedFor.current = undefined;
    setAutoPlayBlocked(false);
  }, [src]);

  useEffect(() => {
    const el = audioRef.current;
    if (autoPlay && el && el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) tryAutoPlay();
  }, [autoPlay, src]);

  function seekTo(seconds: number) {
    const el = audioRef.current;
    if (!el || duration <= 0) return;
    el.currentTime = Math.min(duration, Math.max(0, seconds));
    setCurrent(el.currentTime);
  }

  function onWaveClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    seekTo(((e.clientX - rect.left) / rect.width) * duration);
  }

  function onWaveKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    seekTo(current + (e.key === 'ArrowRight' ? 5 : -5));
  }

  function cycleRate() {
    const rates = [1, 1.25, 1.5, 2];
    const next = rates[(rates.indexOf(rate) + 1) % rates.length];
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-background px-3 py-2.5">
        <audio
          ref={audioRef}
          src={src}
          onCanPlay={tryAutoPlay}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        >
          <track kind="captions" />
        </audio>

        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? t('pause') : t('play')}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105 motion-reduce:transition-none"
        >
          {playing ? (
            <Pause className="h-4 w-4 fill-current" />
          ) : (
            <Play className="ml-[1px] h-4 w-4 fill-current" />
          )}
        </button>

        {/* 可点击 / 方向键 seek 的波形 */}
        <div
          ref={waveRef}
          onClick={onWaveClick}
          onKeyDown={onWaveKeyDown}
          role="slider"
          aria-label={t('playbackProgress')}
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          tabIndex={0}
          className="flex h-9 min-w-0 flex-1 cursor-pointer items-center justify-between rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {bars ? (
            bars.map((h, i) => (
              <span
                key={i}
                style={{ height: `${Math.max(10, h * 100)}%` }}
                className={`w-[2px] shrink-0 rounded-full ${(i + 0.5) / bars.length <= progress ? 'bg-primary' : 'bg-primary/25'}`}
              />
            ))
          ) : (
            <span className="h-[2px] w-full rounded-full bg-primary/20" />
          )}
        </div>

        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {fmt(current)} / {fmt(duration)}
        </span>

        <button
          type="button"
          onClick={cycleRate}
          aria-label={t('playbackSpeed', { rate })}
          className="shrink-0 rounded-md px-1.5 py-1 text-xs font-medium tabular-nums text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {rate}x
        </button>
        <a
          href={src}
          download={downloadName}
          aria-label={t('downloadAudio')}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Download className="h-4 w-4" />
        </a>
      </div>
      {autoPlayBlocked && (
        <p role="status" className="text-xs text-muted-foreground">
          {t('autoplayBlocked')}
        </p>
      )}
    </div>
  );
}

/** 高分辨率峰值 → 指定条数（每条取区间均值，条数多于源时按比例取样） */
function resample(peaks: number[], count: number): number[] {
  const out = new Array<number>(count).fill(0);
  const ratio = peaks.length / count;
  for (let i = 0; i < count; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.max(start + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end && j < peaks.length; j += 1) sum += peaks[j];
    out[i] = sum / (end - start);
  }
  return out;
}

/** 秒 → mm:ss */
function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
