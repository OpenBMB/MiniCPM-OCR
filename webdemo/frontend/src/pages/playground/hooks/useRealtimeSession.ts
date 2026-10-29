/**
 * 实时全双工会话 Hook（MiniCPM-O realtime，替代原半双工 useVoiceChat）。
 *
 * 薄适配层：把 RealtimeConnection 抛出的状态/波形/字幕增量映射到 React 状态，并维护
 * 助手字幕气泡的累积（每轮一条，收到 listen 事件后收尾）。传输/音频/会话时序见
 * utils/realtimeConnection.ts。返回的 VoiceStatus/VoiceMessage/VOICE_BAR_COUNT 供双工组件复用。
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

/** 波形条数量 */
export const VOICE_BAR_COUNT = 40;

/**
 * 模型输出挂断标记后，延迟多久真正挂断。
 * 留一点时间让已缓冲的告别语音播完，避免话没说完就断线。
 */
const HANGUP_DELAY_MS = 2500;

/** 一条字幕消息 */
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

/** 上游实时服务下发的排队信息。 */
export interface RealtimeQueue {
  position?: number;
  estimatedWaitSeconds?: number;
  queueLength?: number;
}

/**
 * 频谱可视化帧。
 *
 * 刻意**不进 React 状态**：频谱由 rAF 以 ~60fps 推送，若每帧 setState，整棵双工组件树
 * （舞台/字幕/控制条/参数面板）每秒重渲染 60 次，字幕掉帧且主线程被挤占后下行音频的排队
 * 调度被推迟、播放出现空隙。消费方（VoiceOrb）本就是 canvas 命令式绘制，直接读这个可变
 * 引用即可，不需要 React 参与。
 */
export interface VizFrame {
  /** 平滑后的音量 0–1，驱动中心脉动 */
  level: number;
  /** 频谱条 0–1，驱动环形柱高 */
  bars: number[];
}

/** connect 当轮参数（model/secret/barCount 由 Hook 注入） */
export type ConnectOptions = Omit<RealtimeConnectOptions, 'barCount' | 'model' | 'secret'> & {
  /** 会话被模型主动结束时回调，供视图同步关摄像头与复位 UI */
  onSessionEnd?: () => void;
};

const IDLE_BARS = (): number[] => new Array(VOICE_BAR_COUNT).fill(0);

/** 实时全双工会话；返回状态、波形、字幕与会话控制方法。 */
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
  /** 模型主动请求结束通话（命中挂断标记），供视图提示"通话已由模型结束" */
  const [endedByModel, setEndedByModel] = useState(false);

  /** 频谱帧：60fps 直写，绕开 React 渲染（见 VizFrame 注释） */
  const viz = useRef<VizFrame>({ level: 0, bars: IDLE_BARS() });
  const conn = useRef<RealtimeConnection | null>(null);
  const idSeq = useRef(0);
  const eventSeq = useRef(0);
  const metricsRef = useRef(metrics);
  const metricsPaintAt = useRef(0);
  const assistantId = useRef<number | null>(null);
  /** 当前轮已累积的字幕（已剔除挂断标记），用于跨 delta 检测被拆断的标记 */
  const turnText = useRef('');
  const hangupTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** 会话结束回调（由视图注入，用于同步关摄像头/复位 UI） */
  const onSessionEnd = useRef<(() => void) | undefined>(undefined);

  function clearHangupTimer() {
    if (hangupTimer.current) clearTimeout(hangupTimer.current);
    hangupTimer.current = undefined;
  }

  /**
   * 命中挂断标记：延迟挂断，留时间播完告别语音。
   * 幂等——同一轮里标记可能被拆成多个 delta，重复触发只保留第一个定时器。
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
   * 助手字幕增量：无进行中气泡则新建，否则续写当前气泡。
   *
   * 挂断标记在**累积后的整段文本**上检测：标记可能被上游拆进相邻两个 delta
   * （如 "[[HANG" + "UP]]"），逐段匹配会漏检。命中后从展示文本剔除并安排挂断。
   * 累积文本用 ref 跟随，避免在 setState updater 里做副作用（updater 须为纯函数）。
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
      // realtime 免费次数在握手通过后消耗；立即刷新，额度用尽时提示创建 API Key。
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
          // 直写可变引用：60fps 不触发任何重渲染，画布下一帧自然读到新值
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
    // onSessionEnd 是 Hook 层回调，不传给传输层
    const { onSessionEnd: onEnd, ...connectOpts } = o;
    onSessionEnd.current = onEnd;
    return ensureConn().connect({
      ...connectOpts,
      // 挂断约定追加在发送时，不污染用户在面板里编辑的系统提示词
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

  // 卸载兜底：断连并清掉待触发的挂断定时器
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
