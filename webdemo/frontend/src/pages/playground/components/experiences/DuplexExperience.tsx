/**
 * Experience-center "realtime audio-video (duplex)" page.
 *
 * Purpose: a call workspace aligned with MiniCPM-o Omni full duplex — video stage (real camera / ring voiceprint) + control bar + full parameters on the right (conversation mode/model/voice/system prompt/TTS switch/voice clone/sampling parameters/devices) + conversation log. The call reaches MiniCPM-O through the backend realtime WS proxy: the microphone streams up continuously, model speech plays downstream, and text becomes captions. In video mode camera frames go upstream at ~1fps for video understanding. Logic is gathered in useRealtimeSession / useCamera and the like.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@map/ui';
import { useTranslation } from 'react-i18next';
import type { usePlaygroundModel } from '../../hooks/usePlaygroundModel';
import { useRealtimeSession, type VoiceStatus } from '../../hooks/useRealtimeSession';
import { useCamera } from '../../hooks/useCamera';
import { useDevices } from '../../hooks/useDevices';
import {
  buildDuplexSystemPrompt,
  useDuplexSettings,
  SOURCES,
  VOICES,
  promptForAudioSource,
} from '../../hooks/useDuplexSettings';
import { VideoStage } from './VideoStage';
import { DuplexControlBar, type RealtimeMode } from './DuplexControlBar';
import { DuplexSidePanel } from './DuplexSidePanel';
import { DuplexConversation } from './DuplexConversation';
import { SessionRecorder, type RecordingResult } from '../../utils/sessionRecorder';
import { fetchRealtimeRefAudioBase64 } from '../../utils/ttsVoices';

type PlaygroundModel = ReturnType<typeof usePlaygroundModel>;
type DuplexTranslate = (key: string, options?: Record<string, number | string>) => string;

const STATUS_HINT: Record<VoiceStatus, string> = {
  idle: 'callIdle',
  requesting: 'callRequesting',
  listening: 'callListening',
  processing: 'callProcessing',
  speaking: 'callSpeaking',
  denied: 'callDenied',
  error: 'callError',
};

/**
 * Realtime audio-video duplex page.
 * @param model Model and key orchestration (from the page-level usePlaygroundModel)
 */
export function DuplexExperience({ model }: { model: PlaygroundModel }) {
  const { t } = useTranslation('playground');
  const translate: DuplexTranslate = (key, options) => t(key, options);
  const { settings: s, patch, selectLanguage, reset } = useDuplexSettings();
  const [sessionActive, setSessionActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [recordOpen, setRecordOpen] = useState(false);
  const [mirror, setMirror] = useState(false);
  const [subtitles, setSubtitles] = useState(true);
  const [recording, setRecording] = useState(false);
  const [mode, setMode] = useState<RealtimeMode>(() =>
    s.audioSource === 'both' ? 'video' : 'audio',
  );
  const [simplexRecording, setSimplexRecording] = useState(false);
  const [recordingResult, setRecordingResult] = useState<RecordingResult | null>(null);
  const [voiceError, setVoiceError] = useState<string>();
  const recorder = useRef(new SessionRecorder());
  const stageRef = useRef<HTMLDivElement>(null);

  const rt = useRealtimeSession(model);
  const cam = useCamera();
  const devices = useDevices();
  const effectiveVoice = VOICES.some((voice) => voice.value === s.voice)
    ? s.voice
    : VOICES[0].value;
  const effectiveSettings = useMemo(
    () => (effectiveVoice === s.voice ? s : { ...s, voice: effectiveVoice }),
    [effectiveVoice, s],
  );

  const videoMode = mode === 'video';
  const simplexMode = mode === 'simplex';
  const forceListen = rt.forceListen;
  const alive = rt.status === 'listening' || rt.status === 'speaking';
  const locked = rt.status !== 'idle' && rt.status !== 'denied' && rt.status !== 'error';
  const rounds = useMemo(
    () => rt.messages.filter((m) => m.role === 'assistant').length,
    [rt.messages],
  );
  const connectionMessage =
    rt.status === 'requesting' ? describeConnection(rt.queue, translate) : undefined;
  // Hint above the control bar: when the model says goodbye on its own, prefer a hint that the call is about to end; otherwise give action guidance from the session state
  const hintText = resolveHint(rt.endedByModel, sessionActive, rt.status, forceListen, translate);
  useEffect(() => {
    if (!sessionActive || paused) return undefined;
    const id = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => window.clearInterval(id);
  }, [sessionActive, paused]);

  // Start the call: in video mode open the camera first (give up on failure), then establish the realtime session; roll back if the connection fails.
  async function startSession() {
    setVoiceError(undefined);
    let cameraStream: MediaStream | null = null;
    if (videoMode) {
      cameraStream = await cam.start();
      if (!cameraStream) return; // cam.error is already set; stay not started
    }
    const voice = VOICES.find((item) => item.value === effectiveVoice);
    let presetRefAudio: string | undefined;
    try {
      if (voice?.refPath) {
        presetRefAudio = await fetchRealtimeRefAudioBase64(voice.refPath);
      }
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : translate('voicePresetLoadError'));
      cam.stop();
      return;
    }
    void devices.refresh();
    setElapsed(0);
    setPaused(simplexMode);
    setSessionActive(true);
    setSimplexRecording(false);
    recorder.current.start();
    rt.appendEvent('recording_started');
    setRecording(true);
    const ok = await rt.connect({
      mode: videoMode ? 'video' : 'audio',
      startPaused: simplexMode,
      system: buildDuplexSystemPrompt(s.system, effectiveVoice, s.language),
      config: {
        length_penalty: s.lengthPenalty,
        max_tokens: s.maxTokens,
        temperature: s.temperature,
        max_kv_tokens: s.maxKvTokens,
        tts_enabled: s.ttsEnabled,
        vision_hd: s.visionHD,
      },
      refAudio: effectiveSettings.refAudio || presetRefAudio,
      ttsRefAudio: effectiveSettings.ttsRefAudio || presetRefAudio,
      micDeviceId: effectiveSettings.micDeviceId || undefined,
      cameraStream,
      playbackDelayMs: s.playbackDelay,
      onInputAudio: (samples) => recorder.current.pushLeft(samples),
      onOutputAudio: (samples, sampleRate, timestamp) =>
        recorder.current.pushRight(samples, sampleRate, timestamp),
      // After the model emits a hang-up marker, end automatically: turn the camera off and reset the UI in sync (the same as clicking "end" manually)
      onSessionEnd: () => {
        const result = recorder.current.stop();
        if (result) setRecordingResult(result);
        rt.appendEvent(
          'recording_completed',
          result
            ? `${Math.round(result.durationSec)}s / ${result.blob.size} bytes`
            : translate('noAudioData'),
        );
        setRecording(false);
        cam.stop();
        setSessionActive(false);
        setPaused(false);
      },
    });
    if (!ok) {
      setSessionActive(false);
      cam.stop();
    }
  }

  function stopSession() {
    const result = recorder.current.stop();
    if (result) setRecordingResult(result);
    rt.appendEvent(
      'recording_completed',
      result
        ? `${Math.round(result.durationSec)}s / ${result.blob.size} bytes`
        : translate('noAudioData'),
    );
    setRecording(false);
    const session = {
      savedAt: new Date().toISOString(),
      model: model.realtimeModel?.display_name || model.realtimeModel?.id || '',
      durationSeconds: elapsed,
      messages: rt.messages,
      events: rt.events,
      metrics: rt.metrics,
    };
    try {
      const history = JSON.parse(window.localStorage.getItem('map-realtime-sessions') || '[]');
      window.localStorage.setItem(
        'map-realtime-sessions',
        JSON.stringify([session, ...history].slice(0, 20)),
      );
    } catch {
      /* best effort */
    }
    rt.disconnect();
    cam.stop();
    setSessionActive(false);
    setPaused(false);
    setSimplexRecording(false);
  }

  function toggleRecording() {
    if (!sessionActive) return;
    if (recording) {
      const result = recorder.current.stop();
      if (result) setRecordingResult(result);
      rt.appendEvent(
        'recording_completed',
        result
          ? `${Math.round(result.durationSec)}s / ${result.blob.size} bytes`
          : translate('noAudioData'),
      );
      setRecording(false);
    } else {
      recorder.current.start();
      rt.appendEvent('recording_started');
      setRecording(true);
    }
  }

  function downloadRecording() {
    if (!recordingResult) return;
    const url = URL.createObjectURL(recordingResult.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `realtime-session-${Date.now()}.wav`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadRecord() {
    const payload = {
      exportedAt: new Date().toISOString(),
      model: model.realtimeModel?.display_name || model.realtimeModel?.id || '',
      durationSeconds: elapsed,
      messages: rt.messages,
      events: rt.events,
      metrics: rt.metrics,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `realtime-session-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function changeSource(source: string) {
    const prompt = promptForAudioSource(source, s.language);
    patch({ audioSource: source, scene: prompt.scene, system: prompt.system });
    setMode(source === 'both' ? 'video' : 'audio');
  }

  // Choosing a voice is an explicit override: clear the old manual reference audio so the session starts with the voice the user just selected.
  function changeVoice(voice: string) {
    patch({
      voice,
      refAudio: undefined,
      refAudioName: undefined,
      ttsRefAudio: undefined,
      ttsRefAudioName: undefined,
    });
  }

  function startSimplexTurn() {
    if (!simplexMode || !sessionActive || rt.status === 'speaking' || rt.status === 'processing')
      return;
    setSimplexRecording(true);
    setPaused(false);
    rt.setPaused(false);
  }

  function finishSimplexTurn() {
    if (!simplexMode || !simplexRecording) return;
    setSimplexRecording(false);
    rt.commitTurn();
    window.setTimeout(() => setPaused(true), 260);
  }

  function toggleForceListen() {
    rt.toggleForceListen();
  }

  async function flipCamera() {
    if (!videoMode) return;
    const next = await cam.flip();
    if (next) rt.setCameraStream(next);
  }

  function toggleFullscreen() {
    if (!stageRef.current) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current.requestFullscreen?.();
  }

  // Pause/resume: pause the upstream microphone (downstream playback is unaffected; in practice this is a session-level pause)
  function togglePause() {
    setPaused((prev) => {
      const next = !prev;
      rt.setPaused(next);
      return next;
    });
  }

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-y-auto px-3 py-4 sm:px-4">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Left: focused call card (picture on top + control bar below, one card, filling to the same height as the right column) */}
        <div className="flex min-w-0 flex-col">
          <section
            ref={stageRef}
            className="relative flex flex-1 flex-col overflow-hidden rounded-2xl bg-card shadow-card"
          >
            <VideoStage
              videoMode={videoMode}
              stream={cam.stream}
              viz={rt.viz}
              active={alive && !paused}
              live={sessionActive}
              elapsed={elapsed}
              messages={rt.messages}
              rounds={rounds}
              onOpenRecord={() => setRecordOpen(true)}
              mirror={mirror}
              subtitles={subtitles}
              subtitleHeightPercent={s.subtitleHeightPercent}
              subtitleBottomOpacity={s.subtitleBottomOpacity}
              subtitleTopOpacity={s.subtitleTopOpacity}
              onToggleMirror={() => setMirror((v) => !v)}
              onFlipCamera={flipCamera}
              onToggleSubtitles={() => setSubtitles((v) => !v)}
              onFullscreen={toggleFullscreen}
              connectionMessage={connectionMessage}
            />

            <div className="flex flex-col items-center gap-3 border-t border-border/50 px-4 py-4">
              <p className="text-center text-sm text-muted-foreground">{hintText}</p>
              {(rt.error || cam.error || voiceError) && (
                <p className="text-xs text-destructive">{rt.error || cam.error || voiceError}</p>
              )}

              <DuplexControlBar
                mode={mode}
                simplexRecording={simplexRecording}
                onStartTurn={startSimplexTurn}
                onFinishTurn={finishSimplexTurn}
                sessionActive={sessionActive}
                voiceStatus={rt.status}
                paused={paused}
                onStart={startSession}
                onStop={stopSession}
                onTogglePause={togglePause}
                forceListen={forceListen}
                onToggleForceListen={toggleForceListen}
                recording={recording}
                hasRecording={recordingResult != null}
                onToggleRecording={toggleRecording}
                onDownloadRecording={downloadRecording}
              />
            </div>
          </section>
        </div>

        {/* Right: full parameter panel */}
        <DuplexSidePanel
          model={model}
          sources={SOURCES}
          voices={VOICES}
          settings={effectiveSettings}
          patch={patch}
          onVoiceChange={changeVoice}
          selectLanguage={selectLanguage}
          onAudioSource={changeSource}
          mics={devices.mics}
          speakers={devices.speakers}
          onRefreshDevices={devices.refresh}
          onReset={reset}
          status={rt.status}
          rounds={rounds}
          locked={locked}
          metrics={rt.metrics}
        />
      </div>

      {/* Full conversation-log dialog */}
      <Dialog open={recordOpen} onOpenChange={setRecordOpen}>
        <DialogContent className="max-w-lg" onClose={() => setRecordOpen(false)}>
          <DialogHeader>
            <DialogTitle>{t('conversationRecord', { count: rounds })}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto pr-1">
            <DuplexConversation messages={rt.messages} events={rt.events} metrics={rt.metrics} />
          </div>
          <button
            type="button"
            onClick={downloadRecord}
            title={translate('downloadConversationRecord')}
            className="self-start rounded-lg border border-border px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted/60"
          >
            {translate('downloadConversation')}
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Hint copy above the control bar.
 * @param endedByModel Whether the model has emitted a hang-up marker (about to end automatically)
 * @param sessionActive Whether the session is in progress
 * @param status Realtime session status
 * @param forceListen Whether the model is being made to listen to the user first
 * @returns The hint copy that should be shown now
 */
function resolveHint(
  endedByModel: boolean,
  sessionActive: boolean,
  status: VoiceStatus,
  forceListen: boolean,
  t: DuplexTranslate,
): string {
  if (forceListen) return t('forceListenActive');
  if (endedByModel) return t('modelEndingCall');
  if (!sessionActive) return t('callStartHint');
  return t(STATUS_HINT[status]);
}

function describeConnection(
  queue?: {
    position?: number;
    estimatedWaitSeconds?: number;
    queueLength?: number;
  },
  t?: DuplexTranslate,
) {
  const translate = t ?? ((key: string) => key);
  if (queue?.position != null) {
    const wait =
      queue.estimatedWaitSeconds == null
        ? ''
        : translate('realtimeQueueWait', { seconds: Math.ceil(queue.estimatedWaitSeconds) });
    return {
      title: translate('realtimeQueueTitle'),
      description: translate('realtimeQueueDescription', { position: queue.position, wait }),
    };
  }
  return {
    title: translate('realtimeConnectingTitle'),
    description: translate('realtimeConnectingDescription'),
  };
}
