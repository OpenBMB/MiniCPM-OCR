/**
 * 实时全双工会话连接（框架无关）。
 *
 * 拥有 WS 传输、麦克风采集(16k)、下行播放(24k)、视频抽帧与会话时序；经回调把状态/波形/
 * 字幕增量/错误抛给上层（useRealtimeSession 负责映射到 React 状态）。协议帧见 realtimeProtocol.ts。
 * MAP API Key 经子协议 `map-api-key.<secret>` 携带，不入 URL/query/日志，并兼作 CSRF 防御；
 * 明文密钥仅由调用方内存传入，本模块不持久化、不打印。
 */

import { CHAT_API_BASE } from '@/api/map/chat';
import { attachSpectrum } from './audioEncode';
import { MicCapture, RealtimePlayer, captureJpegFrame, float32ToBase64 } from './pcmStream';
import {
  buildInputAppend,
  buildSessionClose,
  buildSessionInit,
  parseServerEvent,
  type RealtimeConfig,
} from './realtimeProtocol';

/** 会话状态：空闲/连接中/聆听/处理/播放/权限被拒/出错 */
export type VoiceStatus =
  | 'idle'
  | 'requesting'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'denied'
  | 'error';

/** connect 当轮参数 */
export type RealtimeLifecycleEvent =
  | {
      type:
        | 'connecting'
        | 'worker_assigned'
        | 'session_created'
        | 'listening'
        | 'speaking'
        | 'turn_end'
        | 'closed'
        | 'recording_started'
        | 'recording_completed';
      at: number;
      detail?: string;
      sessionId?: string;
    }
  | {
      type: 'queue';
      at: number;
      position?: number;
      estimatedWaitSeconds?: number;
      queueLength?: number;
    }
  | { type: 'input_chunk'; at: number; video: boolean }
  | { type: 'assistant_audio' | 'assistant_text'; at: number }
  | { type: 'force_listen'; at: number; enabled: boolean }
  | { type: 'pause'; at: number; paused: boolean }
  | { type: 'error'; at: number; message: string };

export interface RealtimeConnectOptions {
  mode: 'audio' | 'video';
  system: string;
  config: RealtimeConfig;
  refAudio?: string;
  micDeviceId?: string;
  cameraStream?: MediaStream | null;
  playbackDelayMs?: number;
  startPaused?: boolean;
  maxKvTokens?: number;
  ttsEnabled?: boolean;
  visionHD?: boolean;
  ttsRefAudio?: string;
  onInputAudio?: (samples: Float32Array) => void;
  onOutputAudio?: (samples: Float32Array, sampleRate: number, timestamp: number) => void;
  barCount: number;
  model: string;
  secret: string;
}

/** 连接向上层抛出的回调集合 */
export interface RealtimeCallbacks {
  onStatus: (status: VoiceStatus) => void;
  onViz: (level: number, bars: number[]) => void;
  onDelta: (text: string) => void;
  onUserText: (text: string) => void;
  onTurnEnd: () => void;
  onLifecycle: (event: RealtimeLifecycleEvent) => void;
  onError: (message: string) => void;
}

const REALTIME_SUBPROTOCOL = 'map.realtime';
const KEY_PROTO_PREFIX = 'map-api-key.';
const VIDEO_MAX_SLICE_NUMS = 1;
const CLOSE_GRACE_PERIOD_MS = 3000;

/** 构造 L2 `/v1/realtime` 的 WS URL（Key 走子协议，绝不入 URL/query）。 */
function buildWsUrl(mode: string, model: string): string {
  const base = CHAT_API_BASE.replace(/\/$/, '');
  const query =
    `?mode=${mode}&model=${encodeURIComponent(model)}&playground_experience=realtime`;
  if (/^https?:\/\//i.test(base)) {
    const u = new URL(base);
    const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${u.host}${u.pathname.replace(/\/$/, '')}/v1/realtime${query}`;
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${base}/v1/realtime${query}`;
}

export class RealtimeConnection {
  private ws: WebSocket | null = null;
  private mic: MicCapture | null = null;
  private player: RealtimePlayer | null = null;
  private stopViz: (() => void) | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private opts: RealtimeConnectOptions | null = null;
  private paused = false;
  private ready = false;
  private initSent = false;
  private forceOnce = false;
  private forceListenActive = false;
  private hdEnabled = false;
  private speaking = false;
  private closed = false;
  private closing = false;
  private closeTimer: number | null = null;

  constructor(private readonly cb: RealtimeCallbacks) {}

  /** 建立会话：麦克风 → 采集/可视化/播放器 → （video）离屏抽帧 → WS 握手。失败返回 false。 */
  async connect(o: RealtimeConnectOptions): Promise<boolean> {
    this.closed = false;
    this.closing = false;
    this.clearCloseTimer();
    this.paused = Boolean(o.startPaused);
    this.forceOnce = false;
    this.forceListenActive = false;
    this.hdEnabled = Boolean(o.visionHD);
    this.opts = o;
    this.cb.onStatus('requesting');
    this.emit({ type: 'connecting', at: Date.now() });

    if (!navigator.mediaDevices?.getUserMedia) {
      return this.fail('当前环境不支持麦克风（需 HTTPS 或 localhost）', 'error');
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: o.micDeviceId ? { deviceId: o.micDeviceId } : true,
      });
    } catch (e) {
      const name = (e as DOMException)?.name;
      const denied = name === 'NotAllowedError' || name === 'SecurityError';
      return this.fail(
        denied ? '麦克风权限被拒绝，请在浏览器允许后重试' : '无法访问麦克风设备',
        denied ? 'denied' : 'error',
      );
    }

    const capture = new MicCapture();
    this.mic = capture;
    await capture.start(stream, (samples) => this.handleChunk(samples));
    if (capture.context) {
      this.stopViz = attachSpectrum(capture.context, stream, o.barCount, this.cb.onViz);
    }
    this.player = new RealtimePlayer(o.playbackDelayMs ?? 0);
    this.player.onRawAudio = (samples, sampleRate, timestamp) =>
      o.onOutputAudio?.(samples, sampleRate, timestamp);
    this.player.init();

    if (o.mode === 'video' && o.cameraStream) {
      const el = document.createElement('video');
      el.srcObject = o.cameraStream;
      el.muted = true;
      el.playsInline = true;
      void el.play().catch(() => undefined);
      this.videoEl = el;
      this.canvas = document.createElement('canvas');
    }

    const sock = new WebSocket(buildWsUrl(o.mode, o.model), [
      REALTIME_SUBPROTOCOL,
      KEY_PROTO_PREFIX + o.secret,
    ]);
    this.ws = sock;
    sock.onopen = () => this.handleSocketOpen();
    sock.onmessage = (ev) => {
      if (typeof ev.data === 'string') this.handleEvent(ev.data);
    };
    sock.onerror = () => {
      if (this.closing) {
        this.cleanup('idle');
        return;
      }
      if (!this.closed) {
        this.cb.onError('实时连接出错，请稍后重试');
        this.cleanup('error');
      }
    };
    sock.onclose = () => {
      if (!this.closed) this.cleanup('idle');
    };
    return true;
  }

  /** 主动挂断（发送 session.close 后清理）。 */
  disconnect(): void {
    if (this.closed || this.closing) return;
    const sock = this.ws;
    if (!sock || sock.readyState !== WebSocket.OPEN) {
      this.cleanup('idle');
      return;
    }
    this.closing = true;
    this.paused = true;
    try {
      sock.send(buildSessionClose('user_stop'));
    } catch {
      this.cleanup('idle');
      return;
    }
    // 停止媒体采集和播放，但保留 WS 读取能力，让服务端终态帧能被消费。
    this.cleanupMediaResources();
    this.cb.onViz(0, new Array(this.opts?.barCount ?? 0).fill(0));
    this.closeTimer = window.setTimeout(() => this.cleanup('idle'), CLOSE_GRACE_PERIOD_MS);
  }

  toggleForceListen(): boolean {
    if (this.closing || !this.ws || this.ws.readyState !== WebSocket.OPEN)
      return this.forceListenActive;
    this.forceListenActive = !this.forceListenActive;
    this.emit({ type: 'force_listen', at: Date.now(), enabled: this.forceListenActive });
    if (this.forceListenActive) {
      this.player?.stopAll();
      this.player?.endTurn();
      this.speaking = false;
    } else {
      this.player?.endTurn();
      this.speaking = false;
    }
    return this.forceListenActive;
  }

  setCameraStream(stream: MediaStream | null): void {
    if (this.videoEl) this.videoEl.srcObject = stream;
  }

  toggleHD(): boolean {
    this.hdEnabled = !this.hdEnabled;
    return this.hdEnabled;
  }

  /** 暂停/恢复上行（暂停时不再发送麦克风数据）。 */
  setPaused(next: boolean): void {
    this.paused = next;
    this.emit({ type: 'pause', at: Date.now(), paused: next });
  }

  /** 单工模式提交当前录音轮次：发送一个带 force_listen 的音频块后暂停上行。 */
  commitTurn(): void {
    this.forceOnce = true;
    this.paused = false;
    window.setTimeout(() => {
      if (!this.closed && !this.closing) this.setPaused(true);
    }, 180);
  }

  private fail(message: string, status: VoiceStatus): boolean {
    this.cb.onError(message);
    this.emit({ type: 'error', at: Date.now(), message });
    this.cb.onStatus(status);
    this.cleanupResources();
    return false;
  }

  private sendInit(): void {
    if (this.initSent || !this.ws || !this.opts) return;
    this.initSent = true;
    const o = this.opts;
    let maxSliceNums: number | undefined;
    if (o.mode === 'video') {
      maxSliceNums = VIDEO_MAX_SLICE_NUMS;
      if (this.hdEnabled) maxSliceNums = 3;
    }
    this.ws.send(
      buildSessionInit(o.system, o.config, {
        refAudioBase64: o.refAudio,
        ttsRefAudioBase64: o.ttsRefAudio,
        maxSliceNums,
      }),
    );
  }

  private handleSocketOpen(): void {
    this.sendInit();
  }

  private handleEvent(data: string): void {
    const evt = parseServerEvent(data);
    if (this.closing && evt.kind !== 'closed') return;
    switch (evt.kind) {
      case 'queue':
        this.emit({
          type: 'queue',
          at: Date.now(),
          position: evt.position,
          estimatedWaitSeconds: evt.estimatedWaitSeconds,
          queueLength: evt.queueLength,
        });
        break;
      case 'queue_done':
        this.emit({ type: 'worker_assigned', at: Date.now() });
        this.sendInit();
        break;
      case 'created':
        this.ready = true;
        this.emit({ type: 'session_created', at: Date.now(), sessionId: evt.sessionId });
        this.cb.onStatus('listening');
        this.emit({ type: 'listening', at: Date.now(), sessionId: evt.sessionId });
        break;
      case 'audio':
        // 优先聆听开启后，上游可能仍有已生成但尚未到达的残余音频帧；
        // 这些帧不能重新写入播放器，否则用户会感觉「打断」没有生效。
        if (this.forceListenActive) return;
        if (!this.speaking) {
          this.speaking = true;
          this.player?.beginTurn();
        }
        this.cb.onStatus('speaking');
        this.emit({ type: 'speaking', at: Date.now() });
        this.emit({ type: 'assistant_audio', at: Date.now() });
        this.player?.enqueue(evt.audio);
        break;
      case 'text':
        this.cb.onDelta(evt.text);
        this.emit({ type: 'assistant_text', at: Date.now() });
        break;
      case 'listen':
        if (evt.text) this.cb.onUserText(evt.text);
        this.speaking = false;
        this.player?.endTurn();
        this.cb.onTurnEnd();
        this.emit({ type: 'turn_end', at: Date.now() });
        this.cb.onStatus('listening');
        this.emit({ type: 'listening', at: Date.now() });
        break;
      case 'closed':
        this.emit({ type: 'closed', at: Date.now(), detail: evt.reason });
        this.cleanup('idle');
        break;
      case 'error':
        this.cb.onError(evt.message);
        this.emit({ type: 'error', at: Date.now(), message: evt.message });
        this.cleanup('error');
        break;
      default:
        break;
    }
  }

  private handleChunk(samples: Float32Array): void {
    if (this.closed || this.closing) return;
    this.opts?.onInputAudio?.(samples);
    this.emit({ type: 'input_chunk', at: Date.now(), video: this.opts?.mode === 'video' });
    const sock = this.ws;
    if (!sock || sock.readyState !== WebSocket.OPEN || !this.ready || this.paused) return;
    let videoFrames: string[] | undefined;
    if (this.opts?.mode === 'video' && this.videoEl && this.canvas) {
      const frame = captureJpegFrame(this.videoEl, this.canvas);
      if (frame) videoFrames = [frame];
    }
    const forceListen = this.forceOnce || this.forceListenActive;
    this.forceOnce = false;
    if (this.forceListenActive) {
      this.forceListenActive = false;
      this.speaking = false;
      this.emit({ type: 'force_listen', at: Date.now(), enabled: false });
    }
    sock.send(
      buildInputAppend(float32ToBase64(samples), {
        forceListen: forceListen || undefined,
        videoFrames,
      }),
    );
  }

  private emit(event: RealtimeLifecycleEvent): void {
    this.cb.onLifecycle(event);
  }

  /** 释放媒体采集、播放和视频预览资源，但保留 WebSocket 供收尾读取。 */
  private cleanupMediaResources(): void {
    this.stopViz?.();
    this.mic?.stop();
    this.player?.stop();
    if (this.videoEl) this.videoEl.srcObject = null;
    this.stopViz = null;
    this.mic = null;
    this.player = null;
    this.videoEl = null;
    this.canvas = null;
    this.ready = false;
    this.initSent = false;
    this.forceOnce = false;
    this.forceListenActive = false;
    this.speaking = false;
  }

  /** 释放媒体和 WebSocket 资源。 */
  private cleanupResources(): void {
    this.clearCloseTimer();
    this.cleanupMediaResources();
    const sock = this.ws;
    if (sock && sock.readyState <= WebSocket.OPEN) sock.close();
    this.ws = null;
  }

  /** 清理主动关闭的有界等待定时器。 */
  private clearCloseTimer(): void {
    if (this.closeTimer !== null) {
      window.clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
  }

  private cleanup(next: VoiceStatus): void {
    this.closed = true;
    this.closing = false;
    this.cleanupResources();
    this.cb.onViz(0, new Array(this.opts?.barCount ?? 0).fill(0));
    this.cb.onStatus(next);
  }
}
