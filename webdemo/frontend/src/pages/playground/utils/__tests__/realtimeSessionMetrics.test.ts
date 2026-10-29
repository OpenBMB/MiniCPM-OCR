import { describe, expect, it } from 'vitest';
import {
  createSessionMetrics,
  reduceSessionMetrics,
  type SessionMetricEvent,
} from '../realtimeSessionMetrics';

describe('realtime session metrics', () => {
  it('tracks input chunks, turns, per-turn first response and vision frames', () => {
    const initial = createSessionMetrics('session-1', 1000);
    const events: SessionMetricEvent[] = [
      { type: 'listening', at: 1100 },
      { type: 'input_chunk', at: 1100, video: true },
      { type: 'input_chunk', at: 1200, video: true },
      { type: 'assistant_audio', at: 1400 },
      { type: 'assistant_text', at: 1500, text: '你好' },
      { type: 'turn_end', at: 1800 },
    ];

    const result = events.reduce(reduceSessionMetrics, initial);

    expect(result).toMatchObject({
      sessionId: 'session-1',
      chunks: 2,
      vision: 2,
      infer: 1,
      turns: 1,
      ttfsMs: 300,
    });
  });

  it('records force listen, pause and errors in the same metrics stream', () => {
    const initial = createSessionMetrics('session-2', 5000);
    const events: SessionMetricEvent[] = [
      { type: 'force_listen', at: 5100, enabled: true },
      { type: 'pause', at: 5200, paused: true },
      { type: 'error', at: 5300, message: '网络异常' },
    ];
    const result = events.reduce(reduceSessionMetrics, initial);

    expect(result.forceListenCount).toBe(1);
    expect(result.pauseCount).toBe(1);
    expect(result.lastError).toBe('网络异常');
  });

  it('records first response from either subtitle or audio only once', () => {
    const initial = createSessionMetrics('session-3', 10_000);
    const events: SessionMetricEvent[] = [
      { type: 'assistant_text', at: 10_180, text: '您好' },
      { type: 'assistant_audio', at: 10_260 },
    ];

    const result = events.reduce(reduceSessionMetrics, initial);

    expect(result.ttfsMs).toBe(180);
    expect(result.infer).toBe(1);
  });

  it('resets TTFS when the model returns to listening for the next turn', () => {
    const initial = createSessionMetrics('session-4', 10_000);
    const events: SessionMetricEvent[] = [
      { type: 'listening', at: 10_100 },
      { type: 'assistant_audio', at: 10_400 },
      { type: 'listening', at: 11_000 },
      { type: 'assistant_text', at: 11_260, text: '第二轮回复' },
    ];

    const result = events.reduce(reduceSessionMetrics, initial);

    expect(result.ttfsMs).toBe(260);
    expect(result.infer).toBe(2);
  });
});
