export interface SessionMetrics {
  sessionId: string;
  startedAt: number;
  chunks: number;
  kv: number;
  vision: number;
  infer: number;
  turns: number;
  ttfsMs?: number;
  turnStartedAt?: number;
  responseStartedAt?: number;
  playbackDelayMs: number;
  aheadMs: number;
  shiftMs: number;
  driftMs: number;
  forceListenCount: number;
  pauseCount: number;
  lastError?: string;
}

export type SessionMetricEvent =
  | { type: 'listening'; at: number }
  | { type: 'input_chunk'; at: number; video: boolean }
  | { type: 'assistant_audio'; at: number }
  | { type: 'assistant_text'; at: number; text: string }
  | { type: 'turn_end'; at: number }
  | { type: 'force_listen'; at: number; enabled: boolean }
  | { type: 'pause'; at: number; paused: boolean }
  | { type: 'playback'; at: number; aheadMs: number; shiftMs: number; driftMs: number }
  | { type: 'kv'; at: number; value: number }
  | { type: 'error'; at: number; message: string };

export function createSessionMetrics(sessionId: string, startedAt = Date.now()): SessionMetrics {
  return {
    sessionId,
    startedAt,
    chunks: 0,
    kv: 0,
    vision: 0,
    infer: 0,
    turns: 0,
    playbackDelayMs: 0,
    aheadMs: 0,
    shiftMs: 0,
    driftMs: 0,
    forceListenCount: 0,
    pauseCount: 0,
  };
}

export function reduceSessionMetrics(
  metrics: SessionMetrics,
  event: SessionMetricEvent,
): SessionMetrics {
  switch (event.type) {
    case 'listening':
      return { ...metrics, turnStartedAt: event.at, responseStartedAt: undefined };
    case 'input_chunk':
      return {
        ...metrics,
        chunks: metrics.chunks + 1,
        vision: metrics.vision + (event.video ? 1 : 0),
      };
    case 'assistant_audio':
      return recordFirstResponse(metrics, event.at);
    case 'assistant_text':
      return recordFirstResponse(metrics, event.at);
    case 'turn_end':
      return { ...metrics, turns: metrics.turns + 1 };
    case 'force_listen':
      return { ...metrics, forceListenCount: metrics.forceListenCount + (event.enabled ? 1 : 0) };
    case 'pause':
      return { ...metrics, pauseCount: metrics.pauseCount + (event.paused ? 1 : 0) };
    case 'playback':
      return { ...metrics, aheadMs: event.aheadMs, shiftMs: event.shiftMs, driftMs: event.driftMs };
    case 'kv':
      return { ...metrics, kv: event.value };
    case 'error':
      return { ...metrics, lastError: event.message };
    default:
      return metrics;
  }
}

function recordFirstResponse(metrics: SessionMetrics, at: number): SessionMetrics {
  if (metrics.responseStartedAt != null) return metrics;
  return {
    ...metrics,
    infer: metrics.infer + 1,
    responseStartedAt: at,
    ttfsMs: Math.max(0, at - (metrics.turnStartedAt ?? metrics.startedAt)),
  };
}
