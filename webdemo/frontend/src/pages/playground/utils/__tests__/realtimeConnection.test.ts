import { describe, expect, it, vi } from 'vitest';
import { RealtimeConnection } from '../realtimeConnection';
import { captureJpegFrame } from '../pcmStream';

vi.mock('../audioEncode', () => ({
  attachSpectrum: vi.fn(),
}));

vi.mock('../pcmStream', () => ({
  MicCapture: class {},
  RealtimePlayer: class {},
  captureJpegFrame: vi.fn(),
  float32ToBase64: vi.fn(() => 'AAAA'),
}));

type TestConnection = {
  disconnect: RealtimeConnection['disconnect'];
  toggleForceListen: RealtimeConnection['toggleForceListen'];
  ws: {
    readyState: number;
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  } | null;
  player: {
    stopAll: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    endTurn: ReturnType<typeof vi.fn>;
    beginTurn: ReturnType<typeof vi.fn>;
    enqueue: ReturnType<typeof vi.fn>;
  } | null;
  ready: boolean;
  opts: {
    mode: 'audio' | 'video';
    system?: string;
    config?: { length_penalty: number; max_tokens: number; temperature: number };
    refAudio?: string;
    ttsRefAudio?: string;
  };
  videoEl: HTMLVideoElement | null;
  canvas: HTMLCanvasElement | null;
  paused: boolean;
  handleChunk: (samples: Float32Array) => void;
  handleEvent: (data: string) => void;
  handleSocketOpen: () => void;
};

function createConnection() {
  const onStatus = vi.fn();
  const onTurnEnd = vi.fn();
  const onLifecycle = vi.fn();
  const connection = new RealtimeConnection({
    onStatus,
    onViz: vi.fn(),
    onDelta: vi.fn(),
    onUserText: vi.fn(),
    onTurnEnd,
    onLifecycle,
    onError: vi.fn(),
  }) as unknown as TestConnection;
  const send = vi.fn();
  const close = vi.fn();
  const stop = vi.fn();
  const stopAll = vi.fn();
  const endTurn = vi.fn();
  const beginTurn = vi.fn();
  const enqueue = vi.fn();
  connection.ws = { readyState: 1, send, close };
  connection.player = { stopAll, stop, endTurn, beginTurn, enqueue };
  connection.ready = true;
  connection.opts = {
    mode: 'audio',
    system: '',
    config: { length_penalty: 1, max_tokens: 1, temperature: 0.7 },
  };
  connection.paused = false;
  return {
    connection,
    send,
    close,
    stopAll,
    endTurn,
    beginTurn,
    enqueue,
    onStatus,
    onTurnEnd,
    onLifecycle,
  };
}

describe('RealtimeConnection Force Listen', () => {
  it('连接未就绪时不切换状态，也不停止播放', () => {
    const { connection, stopAll } = createConnection();
    connection.ws = { readyState: 0, send: vi.fn(), close: vi.fn() };

    expect(connection.toggleForceListen()).toBe(false);
    expect(stopAll).not.toHaveBeenCalled();
  });

  it('开启时立即停播，关闭时释放强制监听，不伪造本地聆听事件', () => {
    const { connection, stopAll, endTurn, onStatus, onTurnEnd, onLifecycle } = createConnection();

    expect(connection.toggleForceListen()).toBe(true);
    expect(stopAll).toHaveBeenCalledOnce();
    expect(endTurn).toHaveBeenCalledOnce();
    expect(onStatus).not.toHaveBeenCalled();
    expect(onTurnEnd).not.toHaveBeenCalled();
    expect(onLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'force_listen', enabled: true }),
    );

    expect(connection.toggleForceListen()).toBe(false);
    expect(stopAll).toHaveBeenCalledOnce();
    expect(endTurn).toHaveBeenCalledTimes(2);
    expect(onLifecycle).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'force_listen', enabled: false }),
    );
  });

  it('开启后后续每个音频块都携带 force_listen', () => {
    const { connection, send } = createConnection();
    connection.toggleForceListen();

    connection.handleChunk(new Float32Array([0]));
    connection.handleChunk(new Float32Array([0]));

    expect(JSON.parse(send.mock.calls[0][0]).input.force_listen).toBe(true);
    expect(JSON.parse(send.mock.calls[1][0]).input).not.toHaveProperty('force_listen');
  });

  it('强制聆听打断后，下一轮模型音频可以重新开始播放', () => {
    const { connection, beginTurn, enqueue } = createConnection();
    connection.toggleForceListen();
    connection.handleChunk(new Float32Array([0]));
    connection.handleEvent('{"type":"response.output.delta","kind":"audio","audio":"AAAA"}');

    expect(beginTurn).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledWith('AAAA');
  });

  it('WebSocket 建立后立即发送 session.init，不等待连接兜底定时器', () => {
    const { connection, send } = createConnection();

    connection.handleSocketOpen();

    expect(send).toHaveBeenCalledOnce();
    expect(JSON.parse(send.mock.calls[0][0]).type).toBe('session.init');
  });

  it('session.init 将双工参考音频透传到官方 voice 对象', () => {
    const { connection, send } = createConnection();
    connection.opts = {
      ...connection.opts,
      system: 'Streaming Omni Conversation.\n\n声音要求：声音沉稳、低沉。',
      refAudio: 'LLM_REF',
      ttsRefAudio: 'TTS_REF',
    };

    connection.handleSocketOpen();

    const frame = JSON.parse(send.mock.calls[0][0]);
    expect(frame.payload.system_prompt).toContain('Streaming Omni Conversation.');
    expect(frame.payload.voice).toEqual({
      ref_audio_base64: 'LLM_REF',
      tts_ref_audio_base64: 'TTS_REF',
    });
  });

  it('主动结束时先等待服务端 session.closed，再关闭底层 WebSocket', () => {
    const { connection, send, close, onStatus } = createConnection();

    connection.disconnect();

    expect(JSON.parse(send.mock.calls[0][0])).toEqual({
      type: 'session.close',
      reason: 'user_stop',
    });
    expect(close).not.toHaveBeenCalled();
    expect(onStatus).not.toHaveBeenLastCalledWith('idle');

    connection.handleEvent('{"type":"session.closed","reason":"user_stop"}');

    expect(close).toHaveBeenCalledOnce();
    expect(onStatus).toHaveBeenLastCalledWith('idle');
  });

  it('服务端不回 session.closed 时按有界超时关闭底层 WebSocket', () => {
    vi.useFakeTimers();
    try {
      const { connection, close } = createConnection();

      connection.disconnect();
      vi.advanceTimersByTime(2999);
      expect(close).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('视频模式把音频和视频帧放进同一个 input.append', () => {
    const { connection, send } = createConnection();
    connection.opts = { ...connection.opts, mode: 'video' };
    connection.videoEl = {} as HTMLVideoElement;
    connection.canvas = {} as HTMLCanvasElement;
    vi.mocked(captureJpegFrame).mockReturnValue('JPEG');

    connection.handleChunk(new Float32Array([0]));

    expect(JSON.parse(send.mock.calls[0][0])).toEqual({
      type: 'input.append',
      input: { audio: 'AAAA', video_frames: ['JPEG'] },
    });
    vi.mocked(captureJpegFrame).mockReset();
  });

  it('优先聆听期间丢弃模型尚在发送的残余音频', () => {
    const { connection, beginTurn, enqueue } = createConnection();
    connection.toggleForceListen();

    connection.handleEvent('{"type":"response.output.delta","kind":"audio","audio":"AAAA"}');

    expect(beginTurn).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('会话创建后进入聆听状态，并在首段音频到达时开始播放', () => {
    const { connection, beginTurn, enqueue, onStatus, onLifecycle } = createConnection();

    connection.handleEvent('{"type":"session.created","session_id":"session-1"}');
    connection.handleEvent('{"type":"response.output.delta","kind":"audio","audio":"AAAA"}');

    expect(onStatus).toHaveBeenNthCalledWith(1, 'listening');
    expect(onStatus).toHaveBeenLastCalledWith('speaking');
    expect(onLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session_created', sessionId: 'session-1' }),
    );
    expect(onLifecycle).toHaveBeenCalledWith(expect.objectContaining({ type: 'assistant_audio' }));
    expect(beginTurn).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledWith('AAAA');
  });

  it('收到排队事件时向界面透传位次与预计等待时间', () => {
    const { connection, onLifecycle } = createConnection();

    connection.handleEvent(
      '{"type":"session.queued","position":2,"estimated_wait_s":6,"queue_length":4}',
    );

    expect(onLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'queue',
        position: 2,
        estimatedWaitSeconds: 6,
        queueLength: 4,
      }),
    );
  });
});
