/**
 * Browser audio DSP plus capture and playback for realtime duplex.
 *
 * Uplink: AudioContext(16kHz) + AudioWorklet emits one Float32 block each time 1s is filled (the browser resamples to
 * 16k automatically) → base64 of raw float32 PCM. Downlink: base64 of upstream 24kHz raw float32 PCM →
 * Float32Array → linear resample to the local AudioContext sample rate → AudioBufferSourceNode queued seamlessly.
 * Video frames: grab JPEG from <video>. Frontend only, no third-party dependency; protocol frame construction is in realtimeProtocol.ts.
 */

import { arrayBufferToBase64 } from './audioEncode';

const UPSTREAM_RATE = 16000;
const DOWNSTREAM_RATE = 24000;

/**
 * capture-processor AudioWorklet source (inlined as a string and registered via a Blob URL,
 * avoiding worklet static-asset path resolution under the Vite `/console/` base).
 * Each time chunkSize samples are filled (default 16000 = 1s@16k), postMessage one Float32 block to the main thread.
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

/** Linear-interpolation resample (fromRate → toRate). Pure function. */
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

/** base64 (raw float32 PCM) → Float32Array. Pure function; a tail that is not 4-byte aligned is safely dropped. */
export function base64ToFloat32(base64: string): Float32Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const usable = bytes.length - (bytes.length % 4);
  if (usable <= 0) return new Float32Array(0);
  return new Float32Array(bytes.buffer, 0, usable / 4);
}

/** Float32 samples → base64 of raw float32 PCM (reuses chunked base64 so a very long string does not blow the stack). */
export function float32ToBase64(samples: Float32Array): string {
  // Copy into an exclusive, exact ArrayBuffer before encoding: a worklet slice view may carry a byteOffset,
  // and encoding needs an ordinary ArrayBuffer (not a SharedArrayBuffer); the cost of one copy per second is negligible.
  const copy = new Float32Array(samples.length);
  copy.set(samples);
  return arrayBufferToBase64(copy.buffer);
}

/**
 * Grab one JPEG frame from <video>, and return raw base64 with the data-URL prefix removed.
 * Return null when the video is not ready yet (width or height is 0).
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
 * Downlink audio player: queue upstream 24kHz raw float32 PCM chunks seamlessly in arrival order.
 * playbackDelayMs reserves a little buffer at the start of each turn, to absorb jitter on the first chunk.
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

  /** Start of a new turn: advance the queue start to the current time (including the playbackDelay buffer). */
  beginTurn(): void {
    if (this.ctx)
      this.nextTime = Math.max(this.nextTime, this.ctx.currentTime + this.delayMs / 1000);
  }

  /** Enqueue one base64 audio segment; resample to the local sample rate, then schedule in order. */
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
    // nextTime behind the current time means the queue has drained (upstream supply or main-thread scheduling cannot keep up with playback):
    // when starting the queue again, put the buffer back, or queueing flush against the current time will break again at the next jitter.
    const startAt =
      this.nextTime > this.ctx.currentTime
        ? this.nextTime
        : this.ctx.currentTime + this.delayMs / 1000;
    src.start(startAt);
    this.nextTime = startAt + buffer.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  /** End of this turn: let audio already queued finish naturally (no operation). */
  endTurn(): void {}

  /** Interrupt: stop immediately and clear every scheduled audio clip. */
  stopAll(): void {
    this.sources.forEach((s) => {
      try {
        s.stop();
      } catch {
        /* stopped */
      }
    });
    this.sources.clear();
    if (this.ctx) this.nextTime = this.ctx.currentTime;
  }

  /** Close the player and release the AudioContext. */
  stop(): void {
    this.stopAll();
    this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.nextTime = 0;
  }
}

/**
 * Uplink microphone capture: AudioContext(16kHz) + AudioWorklet emits one Float32(16k) block every 1s.
 * Do not connect destination, so microphone playback does not cause howling; expose context so spectrum visualization can reuse the same context.
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
