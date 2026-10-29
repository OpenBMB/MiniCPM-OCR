/**
 * Duplex bottom control bar (full duplex).
 *
 * Purpose: the control area for a full-duplex call — "start call" when not in a call; during a call the microphone stays live (no push-to-talk). The center is a realtime status chip (connecting / listening / model speaking / paused), with force-listen / pause / end. All three buttons are real actions. Icons use lucide-react. Pure display component.
 */

import { Tooltip, TooltipContent, TooltipTrigger } from '@map/ui';
import { Mic, MicOff, Volume2, Pause, Play, PhoneOff, Loader2, Ear } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { VoiceStatus } from '../../hooks/useRealtimeSession';

export type RealtimeMode = 'simplex' | 'audio' | 'video';

interface DuplexControlBarProps {
  mode: RealtimeMode;
  sessionActive: boolean;
  simplexRecording: boolean;
  onStartTurn: () => void;
  onFinishTurn: () => void;
  voiceStatus: VoiceStatus;
  paused: boolean;
  onStart: () => void;
  onStop: () => void;
  onTogglePause: () => void;
  forceListen: boolean;
  onToggleForceListen: () => void;
  recording: boolean;
  hasRecording: boolean;
  onToggleRecording: () => void;
  onDownloadRecording: () => void;
}

/**
 * Control bar.
 */
export function DuplexControlBar({
  mode,
  sessionActive,
  simplexRecording,
  onStartTurn,
  onFinishTurn,
  voiceStatus,
  paused,
  onStart,
  onStop,
  onTogglePause,
  forceListen,
  onToggleForceListen,
  recording,
  hasRecording,
  onToggleRecording,
  onDownloadRecording,
}: DuplexControlBarProps) {
  const { t } = useTranslation('playground');
  if (!sessionActive) {
    let startTitle = t('startAudioDuplex');
    if (mode === 'simplex') startTitle = t('startSimplex');
    if (mode === 'video') startTitle = t('startVideoDuplex');
    return (
      <div className="flex justify-center">
        <button
          type="button"
          onClick={onStart}
          title={startTitle}
          className="flex h-12 items-center gap-2.5 rounded-full bg-primary px-8 text-sm font-medium text-primary-foreground shadow-md shadow-primary/25 transition-transform hover:scale-[1.02]"
        >
          <Mic className="h-[18px] w-[18px]" />
          {mode === 'simplex' ? t('startSimplexConversation') : t('startCall')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <StatusPill status={voiceStatus} paused={paused} forceListen={forceListen} />

      {mode === 'simplex' && (
        <button
          type="button"
          onPointerDown={onStartTurn}
          onPointerUp={onFinishTurn}
          onPointerCancel={onFinishTurn}
          title={t('holdToTalk')}
          onKeyDown={(event) => {
            if (event.key === ' ' || event.key === 'Enter') {
              event.preventDefault();
              onStartTurn();
            }
          }}
          onKeyUp={(event) => {
            if (event.key === ' ' || event.key === 'Enter') {
              event.preventDefault();
              onFinishTurn();
            }
          }}
          disabled={voiceStatus === 'speaking' || voiceStatus === 'processing'}
          className={`flex h-10 min-w-36 items-center justify-center gap-2 rounded-full px-5 text-sm font-medium shadow-sm transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50 ${simplexRecording ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground'}`}
        >
          <Mic className="h-4 w-4" />
          {simplexRecording ? t('releaseToSubmitTurn') : t('holdToSpeak')}
        </button>
      )}

      {mode !== 'simplex' && (
        <CtrlBtn
          onClick={onToggleForceListen}
          disabled={voiceStatus === 'requesting'}
          active={forceListen}
          icon={<Ear className="h-4 w-4" />}
          tip={forceListen ? t('forceListenOnHint') : t('forceListenOffHint')}
        >
          {t('forceListen', { state: forceListen ? t('on') : t('off') })}
        </CtrlBtn>
      )}
      <CtrlBtn
        onClick={onToggleRecording}
        icon={
          <span
            className={`h-2.5 w-2.5 rounded-full ${recording ? 'bg-destructive' : 'bg-muted-foreground/50'}`}
          />
        }
        tip={t('recordStereoWav')}
      >
        {recording ? t('recordingInProgress') : t('record')}
      </CtrlBtn>

      {mode !== 'simplex' && (
        <CtrlBtn
          onClick={onTogglePause}
          tip={paused ? t('resumeMicrophone') : t('pauseMicrophone')}
          icon={paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        >
          {paused ? t('resume') : t('pause')}
        </CtrlBtn>
      )}
      <CtrlBtn
        onClick={onStop}
        danger
        tip={voiceStatus === 'requesting' ? t('cancelConnection') : t('endSession')}
        icon={<PhoneOff className="h-4 w-4" />}
      >
        {voiceStatus === 'requesting' ? t('cancelConnectionShort') : t('end')}
      </CtrlBtn>
      {hasRecording && !recording && (
        <CtrlBtn
          onClick={onDownloadRecording}
          tip={t('downloadStereoWav')}
          icon={<span className="text-xs">↓</span>}
        >
          {t('downloadRecording')}
        </CtrlBtn>
      )}
    </div>
  );
}

/** Generic control button */
function CtrlBtn({
  children,
  icon,
  onClick,
  disabled,
  danger,
  active,
  tip,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
  tip?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label={tip}
            aria-pressed={active}
            className={`flex h-9 items-center gap-1.5 rounded-lg border px-4 text-sm font-medium transition-colors disabled:opacity-40 ${
              danger
                ? 'border-destructive/40 text-destructive hover:bg-destructive/10'
                : active
                  ? 'border-amber-500 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20'
                  : 'border-border bg-card text-foreground hover:bg-muted/60'
            }`}
          >
            {icon}
            {children}
          </button>
        </span>
      </TooltipTrigger>
      {tip && <TooltipContent side="top">{tip}</TooltipContent>}
    </Tooltip>
  );
}

/** Realtime status chip (non-interactive; reflects the current session state from voiceStatus/paused) */
function StatusPill({
  status,
  paused,
  forceListen,
}: {
  status: VoiceStatus;
  paused: boolean;
  forceListen: boolean;
}) {
  const { t } = useTranslation('playground');
  const { icon, label, tone } = pillContent(status, paused, forceListen, t);
  return (
    <span
      aria-live="polite"
      className={`flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium ${tone}`}
    >
      {icon}
      {label}
    </span>
  );
}

/** Status-chip content: icon + copy + color */
function pillContent(
  status: VoiceStatus,
  paused: boolean,
  forceListen: boolean,
  t: (key: string, options?: Record<string, string>) => string,
): { icon: React.ReactNode; label: string; tone: string } {
  if (paused)
    return {
      icon: <MicOff className="h-4 w-4" />,
      label: t('paused'),
      tone: 'bg-muted text-muted-foreground',
    };
  if (status === 'error' || status === 'denied') {
    return {
      icon: <MicOff className="h-4 w-4" />,
      label: t('disconnected'),
      tone: 'bg-destructive/10 text-destructive',
    };
  }
  if (forceListen)
    return {
      icon: <Ear className="h-4 w-4" />,
      label: t('forceListen', { state: t('on') }),
      tone: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
    };
  if (status === 'requesting') {
    return {
      icon: <Loader2 className="h-4 w-4 animate-spin" />,
      label: t('connecting'),
      tone: 'bg-muted text-muted-foreground',
    };
  }
  if (status === 'speaking') {
    return {
      icon: <Volume2 className="h-4 w-4" />,
      label: t('modelSpeaking'),
      tone: 'bg-primary/10 text-primary',
    };
  }
  return {
    icon: <Mic className="h-4 w-4" />,
    label: t('listening'),
    tone: 'bg-primary/10 text-primary',
  };
}
