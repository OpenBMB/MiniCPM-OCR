/**
 * 体验中心「实时音视频（双工）」体验页。
 *
 * 用途：对齐 MiniCPM-o Omni 全双工的通话工作台——视频舞台（真摄像头 / 环形声纹）+ 控制栏 +
 * 右侧完整参数（对话模式/模型/音色/系统提示词/TTS开关/音色克隆/采样参数/设备）+ 对话记录。
 * 通话经后端 realtime WS 代理接入 MiniCPM-O：麦克风持续上行、模型语音下行播放、文本转字幕，
 * video 模式下摄像头帧按 ~1fps 上行做视频理解。逻辑收敛在 useRealtimeSession / useCamera 等。
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
 * 实时音视频双工体验页。
 * @param model 模型与密钥编排（来自页面顶层 usePlaygroundModel）
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
  // 控制条上方提示：模型主动告别时优先提示即将结束，其次按会话状态给操作引导
  const hintText = resolveHint(rt.endedByModel, sessionActive, rt.status, forceListen, translate);
  useEffect(() => {
    if (!sessionActive || paused) return undefined;
    const id = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => window.clearInterval(id);
  }, [sessionActive, paused]);

  // 开始通话：视频模式先开摄像头（失败即放弃），再建立 realtime 会话；连接失败回滚。
  async function startSession() {
    setVoiceError(undefined);
    let cameraStream: MediaStream | null = null;
    if (videoMode) {
      cameraStream = await cam.start();
      if (!cameraStream) return; // cam.error 已置，保持未开始
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
      // 模型输出挂断标记后自动结束：同步关摄像头、复位 UI（与手动点「结束」一致）
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

  // 选择音色是一次明确的覆盖操作：清空旧的手动参考音频，确保启动会话时使用用户刚选的音色。
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

  // 暂停/继续：暂停上行麦克风（下行播放不受影响，据实为会话级暂停）
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
        {/* 左：聚焦通话卡（上画面 + 下控制条同卡，填满与右栏等高） */}
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

        {/* 右：完整参数面板 */}
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

      {/* 完整对话记录弹窗 */}
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
 * 控制条上方的提示文案。
 * @param endedByModel 模型是否已输出挂断标记（即将自动结束）
 * @param sessionActive 会话是否进行中
 * @param status 实时会话状态
 * @param forceListen 是否正在让模型优先聆听用户
 * @returns 当前该展示的提示文案
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
