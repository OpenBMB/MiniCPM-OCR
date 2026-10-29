/**
 * Duplex video stage.
 *
 * Purpose: the main visual area of the full-duplex shell — video mode uses useEffect to attach the camera stream to a <video> preview, and voice-only mode shows a ring voiceprint. A floating layer at the bottom of the stage shows the latest conversation captions (immersive, in the manner of Doubao/ChatGPT voice). A LIVE badge and the session duration sit at the top left. In video mode camera frames go upstream at ~1fps for the model to understand the video. Pure display component.
 */

import { useEffect, useRef, type RefObject } from 'react';
import {
  ScrollText,
  VideoOff,
  Maximize2,
  FlipHorizontal2,
  Captions,
  SwitchCamera,
  Loader2,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@map/ui';
import { useTranslation } from 'react-i18next';
import { VoiceOrb } from './VoiceOrb';
import type { VizFrame, VoiceMessage } from '../../hooks/useRealtimeSession';

interface VideoStageProps {
  /** Whether this is video mode (the audio source includes video) */
  videoMode: boolean;
  /** Camera video stream (null means not started) */
  stream: MediaStream | null;
  /** Mutable ref for a spectrum frame, passed through to the voiceprint canvas (not React state; see VizFrame) */
  viz: RefObject<VizFrame>;
  /** Whether the voiceprint is active (listening/playing) */
  active: boolean;
  /** Whether a call is in progress (show LIVE) */
  live: boolean;
  /** Session duration (seconds) */
  elapsed: number;
  /** Conversation messages (the bottom overlay shows the latest few) */
  messages: VoiceMessage[];
  rounds: number;
  onOpenRecord: () => void;
  mirror: boolean;
  subtitles: boolean;
  subtitleHeightPercent: number;
  subtitleBottomOpacity: number;
  subtitleTopOpacity: number;
  onToggleMirror: () => void;
  onFlipCamera: () => void;
  onToggleSubtitles: () => void;
  onFullscreen: () => void;
  connectionMessage?: { title: string; description: string };
}

/**
 * Video stage.
 */
export function VideoStage({
  videoMode,
  stream,
  viz,
  active,
  live,
  elapsed,
  messages,
  rounds,
  onOpenRecord,
  mirror,
  subtitles,
  subtitleHeightPercent,
  subtitleBottomOpacity,
  subtitleTopOpacity,
  onToggleMirror,
  onFlipCamera,
  onToggleSubtitles,
  onFullscreen,
  connectionMessage,
}: VideoStageProps) {
  const { t } = useTranslation('playground');
  const videoRef = useRef<HTMLVideoElement>(null);
  const showVideo = videoMode && stream != null;

  // Reattach srcObject whenever the stream or the video element (remount) changes, so the picture is not blank after switching audio sources
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream, showVideo]);

  const latest = messages.slice(-2);

  return (
    <div className="relative flex min-h-[18rem] w-full flex-1 items-center justify-center overflow-hidden bg-gradient-to-b from-primary/[0.06] to-card">
      {/* Background breathing ambient light */}
      <span
        aria-hidden
        className="pointer-events-none absolute h-64 w-64 rounded-full bg-primary/15 blur-3xl motion-safe:animate-[map-breathe_4.5s_ease-in-out_infinite]"
      />
      {showVideo ? (
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className={`absolute inset-0 h-full w-full object-cover ${mirror ? '-scale-x-100' : ''}`}
        />
      ) : (
        <VoiceOrb viz={viz} active={active} className="w-64 max-w-[70%]" />
      )}

      <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-full bg-background/80 p-1 shadow-sm backdrop-blur-sm">
        <TooltipIcon
          label={t('conversationRecord', { count: rounds })}
          onClick={onOpenRecord}
          disabled={messages.length === 0}
        >
          <ScrollText className="h-3.5 w-3.5" />
        </TooltipIcon>
        {videoMode && (
          <>
            <TooltipIcon label={t('switchCamera')} onClick={onFlipCamera}>
              <SwitchCamera className="h-3.5 w-3.5" />
            </TooltipIcon>
            <TooltipIcon label={t('mirrorVideo')} onClick={onToggleMirror} active={mirror}>
              <FlipHorizontal2 className="h-3.5 w-3.5" />
            </TooltipIcon>
            <TooltipIcon label={t('subtitles')} onClick={onToggleSubtitles} active={subtitles}>
              <Captions className="h-3.5 w-3.5" />
            </TooltipIcon>
            <TooltipIcon label={t('fullscreen')} onClick={onFullscreen}>
              <Maximize2 className="h-3.5 w-3.5" />
            </TooltipIcon>
          </>
        )}
      </div>

      {live && (
        <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-foreground/60 px-2.5 py-1 text-xs font-medium text-background">
          <span className="h-1.5 w-1.5 rounded-full bg-destructive motion-safe:animate-pulse" />
          LIVE {fmtTime(elapsed)}
        </div>
      )}

      {videoMode && !stream && (
        <div className="absolute top-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <VideoOff className="h-3.5 w-3.5" />
          {t('cameraNotStarted')}
        </div>
      )}

      {connectionMessage && (
        <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center bg-card/55 px-6 backdrop-blur-[1px]">
          <div className="flex max-w-xs items-center gap-3 rounded-xl border border-border/60 bg-card/95 px-4 py-3 shadow-lg">
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-foreground">{connectionMessage.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {connectionMessage.description}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Realtime caption overlay: the latest two conversation turns */}
      {subtitles && latest.length > 0 && (
        <div
          className="absolute inset-x-0 bottom-0 flex flex-col justify-end gap-1.5 px-4 pb-4 pt-10"
          style={{
            height: `${Math.min(80, Math.max(5, subtitleHeightPercent))}%`,
            background: `linear-gradient(to top, hsl(var(--foreground) / ${Math.min(100, Math.max(0, subtitleBottomOpacity)) / 100}), hsl(var(--foreground) / ${Math.min(100, Math.max(0, subtitleTopOpacity)) / 100}) 100%)`,
          }}
        >
          {latest.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <span className="max-w-[80%] rounded-xl bg-background/90 px-3 py-1.5 text-sm text-foreground shadow-sm backdrop-blur-sm">
                {m.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TooltipIcon({
  label,
  onClick,
  active,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          className={`rounded-full p-1.5 ${active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'} disabled:cursor-not-allowed disabled:opacity-40`}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="start"
        className="whitespace-nowrap px-2 py-1 text-[11px] font-medium"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/** Seconds → m:ss */
function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
