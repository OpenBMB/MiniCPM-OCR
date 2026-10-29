/**
 * Audio encode and decode helpers for the experience center.
 *
 * Purpose: browser-side audio for voice chat and TTS — decode a recording Blob and resample it to 16kHz mono
 * PCM WAV raw base64 (matching the MiniCPM-o / OpenAI input_audio convention), and assemble upstream base64
 * audio into a playable Object URL. Frontend only, no third-party dependency.
 */

/** Audio format → MIME, used to assemble a playable Blob */
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

/** Raw base64 audio → playable Object URL (the caller revokes it when finished) */
export function base64ToObjectUrl(base64: string, format: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mimeForFormat(format) }));
}

/**
 * Recording or file Blob → { raw base64 of 16kHz mono PCM WAV, duration in seconds }.
 *
 * AudioContext decodes any recording container (webm/opus and so on), OfflineAudioContext resamples to
 * 16kHz mono, then the samples are encoded as 16-bit PCM WAV. One decode yields both the resampled audio and the original duration,
 * which TTS reference-audio duration checks (≤50s) can reuse, avoiding a second decode.
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
 * Recording or file Blob -> uploadable 16kHz mono PCM WAV file.
 *
 * Purpose: convert the webm/opus container typical of the browser MediaRecorder into the WAV
 * file the voice API requires, so the caller can keep using the existing multipart upload path.
 * @param blob audio Blob to convert
 * @param name output file name
 * @returns WAV file and the original duration from decoding
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
 * Recording Blob → raw base64 of 16kHz mono PCM WAV.
 *
 * For input_audio upload (voice chat). Use this when only base64 is needed; it reuses blobToWav16k internally.
 */
export async function blobToWav16kBase64(blob: Blob): Promise<string> {
  return (await blobToWav16k(blob)).base64;
}

/**
 * Audio Blob → raw float32 PCM base64 at 16kHz mono.
 *
 * The realtime reference-audio protocol does not accept a WAV container, only raw float32 PCM; keep this separate from the TTS WAV
 * reference-audio conversion so a container header is not sent to the realtime service by mistake.
 * @param blob audio file to convert
 * @returns base64 of 16kHz mono raw float32 PCM
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

/** Float32 samples → 16-bit PCM WAV (44-byte header included) ArrayBuffer */
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
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byteRate = rate * blockAlign
  view.setUint16(32, 2, true); // blockAlign = channels * bytesPerSample
  view.setUint16(34, 16, true); // bit depth
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
 * Float32 PCM -> WAV Blob.
 *
 * Purpose: when the capture layer already has PCM, produce a standard WAV and avoid depending on the browser MediaRecorder's container
 * encoding and decode compatibility.
 * @param samples mono Float32 PCM samples
 * @param sampleRate sample rate
 * @returns a WAV Blob that can be played and uploaded
 */
export function pcmToWavBlob(samples: Float32Array, sampleRate: number): Blob {
  return new Blob([encodeWavPcm16(samples, sampleRate)], { type: 'audio/wav' });
}

/** ArrayBuffer → base64 (chunked so a very long string does not blow the stack) */
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
 * Audio URL → waveform peak array (length buckets, values 0–1, normalized by the peak amplitude of the whole clip).
 *
 * For drawing a "real" waveform in the player: after decoding, each bucket takes the peak absolute value of its slice. Decode once at a fairly high resolution,
 * then the component resamples to the container width, so window resizes do not decode again. On decode failure (unsupported format or cross-origin)
 * return null; the caller falls back to a placeholder and playback itself is unaffected.
 * @param src audio URL (an Object URL is fine)
 * @param buckets number of peak buckets
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
 * Microphone spectrum visualization: AnalyserNode emits overall level and spectrum bars each frame (imperative rAF).
 * @param onFrame per-frame callback (level 0–1, bars a 0–1 array)
 * @returns stop function (cancels the animation frame)
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
