/**
 * 体验中心音频编解码工具。
 *
 * 用途：语音对话与 TTS 的浏览器侧音频处理——把录音 Blob 解码并重采样为 16kHz mono
 * PCM WAV 的裸 base64（对齐 MiniCPM-o / OpenAI input_audio 约定），以及把上游返回的
 * base64 音频组装成可播放的 Object URL。纯前端，无第三方依赖。
 */

/** 音频格式 → MIME，用于组装可播放的 Blob */
export function mimeForFormat(format: string): string {
  switch (format.toLowerCase()) {
    case 'mp3':
      return 'audio/mpeg';
    case 'opus':
    case 'ogg':
      return 'audio/ogg';
    case 'flac':
      return 'audio/flac';
    case 'wav':
    case 'pcm':
    default:
      return 'audio/wav';
  }
}

/** 裸 base64 音频 → 可播放的 Object URL（调用方负责在不用时 revoke） */
export function base64ToObjectUrl(base64: string, format: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mimeForFormat(format) }));
}

/**
 * 录音/文件 Blob → { 16kHz mono PCM WAV 裸 base64, 时长秒 }。
 *
 * 用 AudioContext 解码任意录音容器（webm/opus 等），再经 OfflineAudioContext 重采样到
 * 16kHz 单声道，最后编码为 16-bit PCM WAV。解码一次即同时拿到重采样音频与原始时长，
 * 供 TTS 参考音频做时长校验（≤50s）复用，避免二次解码。
 */
export async function blobToWav16k(
  blob: Blob,
): Promise<{ base64: string; durationSeconds: number }> {
  const arrayBuf = await blob.arrayBuffer();
  const decodeCtx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuf);
  } finally {
    decodeCtx.close().catch(() => undefined);
  }

  const durationSeconds = decoded.duration;
  const targetRate = 16000;
  const frames = Math.max(1, Math.ceil(decoded.duration * targetRate));
  const offline = new OfflineAudioContext(1, frames, targetRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();

  const wav = encodeWavPcm16(rendered.getChannelData(0), targetRate);
  return { base64: arrayBufferToBase64(wav), durationSeconds };
}

/**
 * 录音/文件 Blob -> 可上传的 16kHz mono PCM WAV 文件。
 *
 * 用途：把浏览器 MediaRecorder 常见的 webm/opus 容器转换成音色接口要求的 WAV
 * 文件，调用方可继续复用现有 multipart 上传链路。
 * @param blob 待转换的音频 Blob
 * @param name 输出文件名
 * @returns WAV 文件与解码得到的原始时长
 */
export async function blobToWav16kFile(
  blob: Blob,
  name = 'recording.wav',
): Promise<{ file: File; durationSeconds: number }> {
  const { base64, durationSeconds } = await blobToWav16k(blob);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return {
    file: new File([bytes], name, { type: 'audio/wav' }),
    durationSeconds,
  };
}

/**
 * 录音 Blob → 16kHz mono PCM WAV 的裸 base64。
 *
 * 供 input_audio 上传（语音对话）。仅需 base64 时用本函数，内部复用 blobToWav16k。
 */
export async function blobToWav16kBase64(blob: Blob): Promise<string> {
  return (await blobToWav16k(blob)).base64;
}

/**
 * 音频 Blob → 16kHz mono 裸 float32 PCM base64。
 *
 * Realtime 参考音频协议不接受 WAV 容器，只接受裸 float32 PCM；与 TTS 的 WAV
 * 参考音频转换保持独立，避免把容器头误传给实时服务。
 * @param blob 待转换的音频文件
 * @returns 16kHz mono 裸 float32 PCM 的 base64
 */
export async function blobToPcm16kBase64(blob: Blob): Promise<string> {
  const arrayBuf = await blob.arrayBuffer();
  const decodeCtx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuf);
  } finally {
    decodeCtx.close().catch(() => undefined);
  }

  const targetRate = 16000;
  const frames = Math.max(1, Math.ceil(decoded.duration * targetRate));
  const offline = new OfflineAudioContext(1, frames, targetRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  const samples = new Float32Array(rendered.getChannelData(0));
  return arrayBufferToBase64(samples.buffer);
}

/** Float32 采样 → 16-bit PCM WAV（含 44 字节头）ArrayBuffer */
function encodeWavPcm16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk 大小
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byteRate = rate * blockAlign
  view.setUint16(32, 2, true); // blockAlign = channels * bytesPerSample
  view.setUint16(34, 16, true); // 位深
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

/**
 * Float32 PCM -> WAV Blob。
 *
 * 用途：录音采集层直接得到 PCM 时生成标准 WAV，避免依赖浏览器 MediaRecorder 的容器
 * 编码与解码兼容性。
 * @param samples 单声道 Float32 PCM 采样
 * @param sampleRate 采样率
 * @returns 可播放、可上传的 WAV Blob
 */
export function pcmToWavBlob(samples: Float32Array, sampleRate: number): Blob {
  return new Blob([encodeWavPcm16(samples, sampleRate)], { type: 'audio/wav' });
}

/** ArrayBuffer → base64（分块避免超长字符串爆栈） */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * 音频 URL → 波形峰值数组（长度 buckets，值 0–1，按整段最大振幅归一）。
 *
 * 供播放器画“真实”波形：解码后按桶取每段绝对值峰值。固定用较高分辨率解码一次，
 * 组件再按容器宽度重采样，避免窗口缩放时反复解码。解码失败（格式不支持/跨域）
 * 返回 null，调用方回退占位，不影响播放本身。
 * @param src 音频 URL（Object URL 亦可）
 * @param buckets 峰值桶数
 */
export async function decodeWaveformPeaks(src: string, buckets: number): Promise<number[] | null> {
  try {
    const arrayBuf = await (await fetch(src)).arrayBuffer();
    const ctx = new AudioContext();
    let decoded: AudioBuffer;
    try {
      decoded = await ctx.decodeAudioData(arrayBuf);
    } finally {
      ctx.close().catch(() => undefined);
    }

    const data = decoded.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / buckets));
    const peaks = new Array<number>(buckets).fill(0);
    let max = 0;
    for (let i = 0; i < buckets; i += 1) {
      let peak = 0;
      for (let j = i * step; j < (i + 1) * step && j < data.length; j += 1) {
        const v = Math.abs(data[j]);
        if (v > peak) peak = v;
      }
      peaks[i] = peak;
      if (peak > max) max = peak;
    }
    return max > 0 ? peaks.map((p) => p / max) : peaks;
  } catch {
    return null;
  }
}

/**
 * 麦克风频谱可视化：AnalyserNode 逐帧输出整体音量与频谱条（命令式 rAF）。
 * @param onFrame 每帧回调（level 0–1，bars 0–1 数组）
 * @returns 停止函数（取消动画帧）
 */
export function attachSpectrum(
  ctx: AudioContext,
  stream: MediaStream,
  barCount: number,
  onFrame: (level: number, bars: number[]) => void,
): () => void {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 128;
  analyser.smoothingTimeConstant = 0.8;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Uint8Array(analyser.frequencyBinCount);
  let raf = 0;
  const tick = () => {
    analyser.getByteFrequencyData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i += 1) sum += buf[i];
    const step = Math.max(1, Math.floor(buf.length / barCount));
    const bars = new Array<number>(barCount);
    for (let i = 0; i < barCount; i += 1) bars[i] = (buf[i * step] ?? 0) / 255;
    onFrame(sum / buf.length / 255, bars);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
