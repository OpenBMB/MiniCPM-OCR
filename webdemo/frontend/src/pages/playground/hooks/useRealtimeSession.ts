/**
 * Realtime full-duplex session hook (MiniCPM-O realtime, replacing the old half-duplex useVoiceChat).
 *
 * A thin adapter: map state, waveform, and caption increments thrown by RealtimeConnection onto React state, and maintain
 * accumulation of the assistant caption bubble (one per turn, closed when a listen event arrives). Transport, audio, and session timing are in
 * utils/realtimeConnection.ts. The returned VoiceStatus, VoiceMessage, and VOICE_BAR_COUNT are reused by duplex components.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RealtimeConnection,
  type RealtimeConnectOptions,
  type VoiceStatus,
  type RealtimeLifecycleEvent,
} from '../utils/realtimeConnection';
import {
  createSessionMetrics,
  reduceSessionMetrics,
  type SessionMetrics,
} from '../utils/realtimeSessionMetrics';
import { stripHangupMarker, withHangupProtocol } from '../utils/realtimeProtocol';
import type { usePlaygroundModel } from './usePlaygroundModel';

export type { VoiceStatus } from '../utils/realtimeConnection';

type PlaygroundModel = ReturnType<typeof usePlaygroundModel>;

/** Number of waveform bars */
export const VOICE_BAR_COUNT = 40;

/**
 * How long to wait after the model outputs the hang-up marker before actually hanging up.
 * Leave a little time for the buffered goodbye audio to finish playing, so the line does not drop before the sentence is finished.
 */
const HANGUP_DELAY_MS = 2500;

/** One caption message */
export interface VoiceEvent {
  id: number;
  at: number;
  label: string;
  detail?: string;
  kind: RealtimeLifecycleEvent['type'];
}

export interface VoiceMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
}

/** Queue info issued by the upstream realtime service. */
export interface RealtimeQueue {
  position?: number;
  estimatedWaitSeconds?: number;
  queueLength?: number;
}

/**
 * A spectrum visualization frame.
 *
 * Deliberately **not in React state**: the spectrum is pushed by rAF at ~60fps. If every frame called setState, the whole duplex component tree
 * (stage, captions, control bar, parameter panel) would re-render 60 times a second, captions would drop frames, and once the main thread is crowded the downlink audio queue
 * scheduling would be delayed and playback would gap. The consumer (VoiceOrb) already draws the canvas imperatively, so it can read this mutable
 * reference directly and does not need React involved.
 */
export interface VizFrame {
  /** Smoothed volume 0–1, driving the center pulse */
  level: number;
  /** Spectrum bars 0–1, driving the ring bar height */
  bars: number[];
}

/** Parameters for this connect turn (model, secret, and barCount are injected by the hook) */
export type ConnectOptions = Omit<RealtimeConnectOptions, 'barCount' | 'model' | 'secret'> & {
  /** Callback when the session is ended by the model on purpose, so the view can turn the camera off and reset the UI in sync */
  onSessionEnd?: () => void;
};

const IDLE_BARS = (): number[] => new Array(VOICE_BAR_COUNT).fill(0);

/** Realtime full-duplex session; returns state, waveform, captions, and session control methods. */
export function useRealtimeSession(model: PlaygroundModel) {
  const { t } = useTranslation('playground');
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [messages, setMessages] = useState<VoiceMessage[]>([]);
  const [events, setEvents] = useState<VoiceEvent[]>([]);
  const [metrics, setMetrics] = useState<SessionMetrics>(() =>
    createSessionMetrics(t('disconnected')),
  );
  const [sessionId, setSessionId] = useState('');
  const [error, setError] = useState<string>();
  const [queue, setQueue] = useState<RealtimeQueue>();
  const [forceListen, setForceListen] = useState(false);
  /** The model requested to end the call on purpose (the hang-up marker was hit), so the view can say "the call was ended by the model" */
  const [endedByModel, setEndedByModel] = useState(false);

  /** Spectrum frame: written directly at 60fps, bypassing React render (see the VizFrame comment) */
  const viz = useRef<VizFrame>({ level: 0, bars: IDLE_BARS() });
  const conn = useRef<RealtimeConnection | null>(null);
  const idSeq = useRef(0);
  const eventSeq = useRef(0);
  const metricsRef = useRef(metrics);
  const metricsPaintAt = useRef(0);
  const assistantId = useRef<number | null>(null);
  /** Caption accumulated for the current turn (hang-up marker already removed), used to detect a marker split across deltas */
  const turnText = useRef('');
  const hangupTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Session-end callback (injected by the view, used to turn the camera off and reset the UI in sync) */
  const onSessionEnd = useRef<(() => void) | undefined>(undefined);

  function clearHangupTimer() {
    if (hangupTimer.current) clearTimeout(hangupTimer.current);
    hangupTimer.current = undefined;
  }

  /**
   * The hang-up marker was hit: delay the hang-up, leaving time for the goodbye audio to finish.
   * Idempotent — within one turn the marker may be split across several deltas, and repeated triggers keep only the first timer.
   */
  function scheduleHangup() {
    if (hangupTimer.current) return;
    setEndedByModel(true);
    hangupTimer.current = setTimeout(() => {
      hangupTimer.current = undefined;
      conn.current?.disconnect();
      onSessionEnd.current?.();
    }, HANGUP_DELAY_MS);
  }

  /**
   * Assistant caption increment: if there is no bubble in progress, create one; otherwise continue the current bubble.
   *
   * The hang-up marker is detected on the **whole accumulated text**: the marker may be split by the upstream into two adjacent deltas
   * (such as "[[HANG" + "UP]]"), and matching segment by segment would miss it. After a hit, strip it from the displayed text and schedule the hang-up.
   * Accumulated text is followed with a ref, so a side effect is not done inside a setState updater (an updater must be a pure function).
   */
  function pushUserText(text: string): void {
    if (!text.trim()) return;
    idSeq.current += 1;
    setMessages((prev) => [...prev, { id: idSeq.current, role: 'user', text: text.trim() }]);
  }

  function pushDelta(text: string): void {
    if (!text) return;
    const merged = turnText.current + text;
    const { clean, hangup } = stripHangupMarker(merged);
    turnText.current = clean;
    if (hangup) scheduleHangup();
    setMessages((prev) => {
      if (assistantId.current == null) {
        idSeq.current += 1;
        assistantId.current = idSeq.current;
        return [...prev, { id: idSeq.current, role: 'assistant', text: clean }];
      }
      const id = assistantId.current;
      return prev.map((m) => (m.id === id ? { ...m, text: clean } : m));
    });
  }

  function handleLifecycle(event: RealtimeLifecycleEvent): void {
    const labels: Record<RealtimeLifecycleEvent['type'], string> = {
      connecting: 'Connecting',
      queue: 'Queueing',
      worker_assigned: 'Worker assigned',
      session_created: 'Session created',
      listening: 'Listening',
      speaking: t('modelSpeaking'),
      turn_end: 'End of turn',
      input_chunk: t('audio'),
      assistant_audio: t('ttsResponse'),
      assistant_text: t('realtime'),
      force_listen:
        event.type === 'force_listen' && event.enabled ? 'Force Listen ON' : 'Force Listen OFF',
      pause: event.type === 'pause' && event.paused ? 'Pause' : 'Resume',
      closed: 'Session closed',
      error: 'Error',
      recording_started: 'Recording started',
      recording_completed: 'Recording completed',
    };
    eventSeq.current += 1;
    if (
      event.type !== 'input_chunk' &&
      event.type !== 'assistant_audio' &&
      event.type !== 'assistant_text'
    ) {
      setEvents((prev) =>
        [
          ...prev,
          {
            id: eventSeq.current,
            at: event.at,
            label: labels[event.type],
            detail: 'detail' in event ? event.detail : undefined,
            kind: event.type,
          },
        ].slice(-200),
      );
    }
    const next = reduceSessionMetrics(
      metricsRef.current,
      event as Parameters<typeof reduceSessionMetrics>[1],
    );
    metricsRef.current = next;
    const shouldPaintMetrics =
      (event.type !== 'input_chunk' &&
        event.type !== 'assistant_audio' &&
        event.type !== 'assistant_text') ||
      event.at - metricsPaintAt.current >= 500;
    if (shouldPaintMetrics) {
      metricsPaintAt.current = event.at;
      setMetrics(next);
    }
    if (event.type === 'session_created') {
      // Realtime free count is consumed after the handshake succeeds; refresh immediately, and when the quota is used up prompt to create an API Key.
      model.refreshTrial();
      const nextId = event.sessionId || `local-${event.at}`;
      setSessionId(nextId);
      setMetrics((current) => ({ ...current, sessionId: nextId }));
      metricsRef.current = { ...next, sessionId: nextId };
    }
    if (event.type === 'force_listen') setForceListen(event.enabled);
    if (event.type === 'queue') {
      setQueue({
        position: event.position,
        estimatedWaitSeconds: event.estimatedWaitSeconds,
        queueLength: event.queueLength,
      });
    }
    if (
      event.type === 'worker_assigned' ||
      event.type === 'session_created' ||
      event.type === 'closed' ||
      event.type === 'error'
    ) {
      setQueue(undefined);
    }
  }

  function appendEvent(kind: 'recording_started' | 'recording_completed', detail?: string): void {
    handleLifecycle({ type: kind, at: Date.now(), detail });
  }

  function ensureConn(): RealtimeConnection {
    if (!conn.current) {
      conn.current = new RealtimeConnection({
        onStatus: (nextStatus) => {
          setStatus(nextStatus);
          if (nextStatus === 'idle' || nextStatus === 'error' || nextStatus === 'denied') {
            setQueue(undefined);
            setForceListen(false);
          }
        },
        onViz: (lvl, next) => {
          // Write the mutable reference directly: 60fps triggers no re-render, and the canvas reads the new value on the next frame
          viz.current.level = viz.current.level * 0.7 + lvl * 0.3;
          viz.current.bars = next;
        },
        onDelta: pushDelta,
        onUserText: pushUserText,
        onLifecycle: handleLifecycle,
        onTurnEnd: () => {
          assistantId.current = null;
          turnText.current = '';
        },
        onError: setError,
      });
    }
    return conn.current;
  }

  async function connect(o: ConnectOptions): Promise<boolean> {
    setError(undefined);
    setMessages([]);
    setEvents([]);
    setQueue(undefined);
    setForceListen(false);
    const startedAt = Date.now();
    const newSessionId = `local-${startedAt}`;
    setSessionId(newSessionId);
    metricsRef.current = createSessionMetrics(newSessionId, startedAt);
    setMetrics(metricsRef.current);
    assistantId.current = null;
    turnText.current = '';
    clearHangupTimer();
    setEndedByModel(false);
    setStatus('requesting');
    const secret = model.getSecret();
    const modelId = model.realtimeModel?.id;
    const credentialAvailable = model.trialAvailable || model.hasKeys;
    if (!modelId) {
      setError(t('noRealtimeModel'));
      setStatus('error');
      return false;
    }
    if (!credentialAvailable) {
      setError(model.keysLoading ? t('sendKeyLoading') : t('sendNoApiKey'));
      setStatus('error');
      return false;
    }
    if (!secret) {
      setError(t('apiKeyNotReady'));
      setStatus('error');
      return false;
    }
    // onSessionEnd is a hook-level callback and is not passed to the transport layer
    const { onSessionEnd: onEnd, ...connectOpts } = o;
    onSessionEnd.current = onEnd;
    return ensureConn().connect({
      ...connectOpts,
      // The hang-up convention is appended at send time, so it does not contaminate the system prompt the user edits in the panel
      system: withHangupProtocol(o.system),
      barCount: VOICE_BAR_COUNT,
      model: modelId,
      secret,
    });
  }

  function disconnect(): void {
    clearHangupTimer();
    conn.current?.disconnect();
  }

  function setPaused(next: boolean): void {
    conn.current?.setPaused(next);
  }

  function commitTurn(): void {
    conn.current?.commitTurn();
  }

  function toggleForceListen(): boolean {
    return conn.current?.toggleForceListen() ?? false;
  }

  function setCameraStream(stream: MediaStream | null): void {
    conn.current?.setCameraStream(stream);
  }

  function toggleHD(): boolean {
    return conn.current?.toggleHD() ?? false;
  }

  // Unmount fallback: disconnect and clear a hang-up timer that has not fired yet
  useEffect(
    () => () => {
      clearHangupTimer();
      conn.current?.disconnect();
    },
    [],
  );

  return {
    status,
    viz,
    messages,
    events,
    metrics,
    sessionId,
    error,
    queue,
    forceListen,
    endedByModel,
    connect,
    disconnect,
    setPaused,
    commitTurn,
    toggleForceListen,
    toggleHD,
    setCameraStream,
    appendEvent,
  };
}
