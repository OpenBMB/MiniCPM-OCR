/**
 * 实时双工的浏览器音频 DSP 与采集/播放。
 *
 * 上行：AudioContext(16kHz) + AudioWorklet 每积满 1s 输出一块 Float32（浏览器自动重采样到
 * 16k）→ 裸 float32 PCM 的 base64。下行：上游 24kHz 裸 float32 PCM 的 base64 →
 * Float32Array → 线性重采样到本地 AudioContext 采样率 → AudioBufferSourceNode 无缝排队播放。
 * 视频帧：从 <video> 抓 JPEG。纯前端，无第三方依赖；协议帧构造见 realtimeProtocol.ts。
 */

import { arrayBufferToBase64 } from './audioEncode';

const UPSTREAM_RATE = 16000;
const DOWNSTREAM_RATE = 24000;

/**
 * capture-processor AudioWorklet 源码（内联为字符串，经 Blob URL 注册，
 * 避免 Vite `/console/` base 下 worklet 静态资源路径解析问题）。
 * 每积满 chunkSize 个采样（默认 16000 = 1s@16k）向主线程 postMessage 一块 Float32。
 */
const CAPTURE_WORKLET_SRC = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._chunkSize = (options && options.processorOptions && options.processorOptions.chunkSize) || 16000;
    this._buffer = new Float32Array(this._chunkSize);
    this._offset = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this._buffer[this._offset++] = ch[i];
        if (this._offset >= this._chunkSize) {
          const out = this._buffer.slice(0);
          this.port.postMessage({ type: 'chunk', audio: out }, [out.buffer]);
          this._offset = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
`;

/** 线性插值重采样（fromRate → toRate）。纯函数。 */
export function resamplePcm(
  samples: Float32Array<ArrayBuffer>,
  fromRate: number,
  toRate: number,
): Float32Array<ArrayBuffer> {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const newLen = Math.round(samples.length / ratio);
  const out = new Float32Array(newLen);
  for (let i = 0; i < newLen; i += 1) {
    const srcIdx = i * ratio;
    const floor = Math.floor(srcIdx);
    const frac = srcIdx - floor;
    const next = Math.min(floor + 1, samples.length - 1);
    out[i] = samples[floor] * (1 - frac) + samples[next] * frac;
  }
  return out;
}

/** base64（裸 float32 PCM）→ Float32Array。纯函数；非 4 字节对齐的尾部安全丢弃。 */
export function base64ToFloat32(base64: string): Float32Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const usable = bytes.length - (bytes.length % 4);
  if (usable <= 0) return new Float32Array(0);
  return new Float32Array(bytes.buffer, 0, usable / 4);
}

/** Float32 采样 → 裸 float32 PCM 的 base64（复用分块 base64，避免超长字符串爆栈）。 */
export function float32ToBase64(samples: Float32Array): string {
  // 拷贝出独占且精确的 ArrayBuffer 再编码：worklet 切片视图可能带 byteOffset，
  // 且编码需普通 ArrayBuffer（非 SharedArrayBuffer）；每秒 1 块的拷贝成本可忽略。
  const copy = new Float32Array(samples.length);
  copy.set(samples);
  return arrayBufferToBase64(copy.buffer);
}

/**
 * 从 <video> 抓一帧 JPEG，返回去掉 data URL 前缀的裸 base64。
 * 视频尚未就绪（宽或高为 0）时返回 null。
 */
export function captureJpegFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  quality = 0.7,
): string | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : null;
}

/**
 * 下行音频播放器：把上游 24kHz 裸 float32 PCM 分块按到达顺序无缝排入播放队列。
 * playbackDelayMs 用于每轮开始时预留少量缓冲，缓解首块抖动。
 */
export class RealtimePlayer {
  private ctx: AudioContext | null = null;
  onRawAudio?: (samples: Float32Array, sampleRate: number, timestamp: number) => void;
  private nextTime = 0;
  private readonly sources = new Set<AudioBufferSourceNode>();

  constructor(private readonly delayMs = 0) {}

  init(): void {
    if (!this.ctx || this.ctx.state === 'closed') this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.nextTime = this.ctx.currentTime;
  }

  /** 新一轮开始：把排队起点推进到当前时刻（含 playbackDelay 缓冲）。 */
  beginTurn(): void {
    if (this.ctx)
      this.nextTime = Math.max(this.nextTime, this.ctx.currentTime + this.delayMs / 1000);
  }

  /** 排入一段 base64 音频；重采样到本地采样率后按序调度。 */
  enqueue(base64: string): void {
    if (!this.ctx) return;
    const rawSamples = base64ToFloat32(base64);
    if (rawSamples.length === 0) return;
    this.onRawAudio?.(rawSamples, DOWNSTREAM_RATE, performance.now());
    const samples = resamplePcm(rawSamples, DOWNSTREAM_RATE, this.ctx.sampleRate);
    if (samples.length === 0) return;
    const buffer = this.ctx.createBuffer(1, samples.length, this.ctx.sampleRate);
    buffer.copyToChannel(samples, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.ctx.destination);
    // nextTime 落后于当前时刻说明队列已放空（上游供给或主线程调度跟不上播放）：
    // 重新起排时补回缓冲，否则紧贴当前时刻排队，下一次抖动会立刻再断一次。
    const startAt =
      this.nextTime > this.ctx.currentTime
        ? this.nextTime
        : this.ctx.currentTime + this.delayMs / 1000;
    src.start(startAt);
    this.nextTime = startAt + buffer.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  /** 本轮结束：让已排队音频自然播完（无操作）。 */
  endTurn(): void {}

  /** 打断：立即停止并清空所有已调度音频。 */
  stopAll(): void {
    this.sources.forEach((s) => {
      try {
        s.stop();
      } catch {
        /* 已停止 */
      }
    });
    this.sources.clear();
    if (this.ctx) this.nextTime = this.ctx.currentTime;
  }

  /** 关闭播放器并释放 AudioContext。 */
  stop(): void {
    this.stopAll();
    this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.nextTime = 0;
  }
}

/**
 * 上行麦克风采集：AudioContext(16kHz) + AudioWorklet 每 1s 输出一块 Float32(16k)。
 * 不接 destination，避免麦克风回放造成啸叫；暴露 context 供频谱可视化复用同一上下文。
 */
export class MicCapture {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private workletUrl = '';

  get context(): AudioContext | null {
    return this.ctx;
  }

  async start(stream: MediaStream, onChunk: (samples: Float32Array) => void): Promise<void> {
    const ctx = new AudioContext({ sampleRate: UPSTREAM_RATE });
    this.ctx = ctx;
    if (ctx.state === 'suspended') await ctx.resume();
    this.workletUrl = URL.createObjectURL(
      new Blob([CAPTURE_WORKLET_SRC], { type: 'application/javascript' }),
    );
    await ctx.audioWorklet.addModule(this.workletUrl);
    const node = new AudioWorkletNode(ctx, 'capture-processor', {
      processorOptions: { chunkSize: UPSTREAM_RATE },
    });
    node.port.onmessage = (ev: MessageEvent) => {
      const data = ev.data as { type?: string; audio?: Float32Array };
      if (data?.type === 'chunk' && data.audio) onChunk(data.audio);
    };
    this.node = node;
    this.src = ctx.createMediaStreamSource(stream);
    this.src.connect(node);
  }

  stop(): void {
    if (this.node) this.node.port.onmessage = null;
    this.node?.disconnect();
    this.src?.disconnect();
    this.ctx?.close().catch(() => undefined);
    if (this.workletUrl) URL.revokeObjectURL(this.workletUrl);
    this.ctx = null;
    this.node = null;
    this.src = null;
    this.workletUrl = '';
  }
}
