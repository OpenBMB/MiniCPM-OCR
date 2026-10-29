/**
 * MAP experience center speech synthesis (TTS) API.
 *
 * Purpose: TTS synthesis uses L2’s OpenAI-compatible `/v1/audio/speech` (LIS VoxCPM2, contract voxcpm_speech@2).
 * The experience center requests WAV; L2 forces stream=true and returns SSE. The frontend aggregates
 * the live `audio` field in `speech.audio.delta`, still accepts the historical `delta` field, and after `speech.audio.done` builds
 * a playable audio Blob. That terminal event is also the only metering point where LIS returns authoritative token usage, so the usage-less
 * unary path is no longer used.
 *
 * Voice: VoxCPM has no named voice library, and upstream returns 4xx for an unknown voice, so `voice` is always `default`. Voice differences come only from
 * `ref_audio` reference audio (zero-shot cloning). For safety, reference audio accepts only inline Base64 WAV
 * (`data:audio/wav;base64,...`), no URL of any kind, with a 5 MiB limit after decoding.
 *
 * The voice description (control, Control Instruction) is injected into input as a `(description)` prefix. VoxCPM parses it natively: with no reference audio
 * it is voice design; with reference audio it layers emotion, pace, and style on the clone. Guidance strength (cfg → cfg_value), reference-audio
 * denoising (denoise), and text normalization (do_normalize) are sent only when needed. The contract does not list these three fields; we pass them through, and whether they take effect
 * depends on upstream LIS capability (M0 contract item). They are sent only when the user changes them explicitly; the default path carries no extra-contract fields.
 * Realtime full-duplex voice conversation does not use this module; the realtime WebSocket channel (utils/realtimeConnection.ts) carries it.
 *
 * L2 passes the body through to LIS as map[string]any. Do **not** reuse mapRequest (that one unwraps the L3 envelope);
 * use the plaintext API Key as the Bearer token.
 *
 * Security: secret (plaintext lis_sk_xxx) is passed in memory by the caller only. This module does not persist or print it.
 */

import { CHAT_API_BASE } from './chat';
import { createPlaygroundClientRequestID } from './chat';
import { getToken } from './request';

/** Output format used by the experience center (the platform forces SSE and supports only WAV) */
export type TtsFormat = 'wav';

/** TTS synthesis result: an object URL that can be played or downloaded directly (the caller must revoke it) */
export interface TtsResult {
  /** Object URL created from the binary audio blob */
  objectUrl: string;
  /** Actual output format, used to derive the download filename */
  format: TtsFormat;
}

/** TTS synthesis input (private voices use voice_xxx; temporary reference audio uses refAudio) */
export interface SynthesizeParams {
  model: string;
  secret: string;
  /** Text to synthesize (Target Text) */
  text: string;
  /** Platform private-voice ID; MAP checks ownership of voice_xxx and then resolves it */
  voice?: string;
  /**
   * Voice description / style control (Control Instruction, optional). When non-empty, inject it into input as a `(description)` prefix.
   * VoxCPM parses it natively: with no reference audio it builds a voice from the description (voice design); with reference audio it layers style on top.
   */
  control?: string;
  /**
   * Reference-audio data URI (`data:audio/wav;base64,...`), used for voice cloning; omit it to skip cloning.
   * The contract allows only inline Base64 WAV and rejects http/https/file URLs; decoded size must not exceed 5 MiB.
   */
  refAudio?: string;
  /** Guidance strength cfg_value (higher values follow the prompt or reference voice more closely). Omit it to keep the upstream default */
  cfg?: number;
  /**
   * Reference-audio denoise enhancement (denoise). Send denoise=true only when this is true. The official demo treats it as a separate preprocess;
   * we pass the field through to upstream, and whether it actually takes effect depends on LIS capability (M0 contract item).
   */
  denoise?: boolean;
  /**
   * Text normalization (do_normalize). Send do_normalize=true only when this is true. This is also a pass-through field,
   * and whether it takes effect depends on upstream (M0 contract item).
   */
  normalize?: boolean;
  /** Experience-center correlation ID; generated automatically when omitted */
  clientRequestID?: string;
  signal?: AbortSignal;
}

/**
 * Text to speech (TTS). Uses L2 `/v1/audio/speech`; the platform forces SSE, and the browser aggregates it into a complete audio file.
 * @returns A playable/downloadable object URL and the actual format (the caller must URL.revokeObjectURL when finished)
 * @throws Error when upstream is not 2xx or returns no audio (includes readable copy)
 */
export async function synthesizeSpeech(params: SynthesizeParams): Promise<TtsResult> {
  // Inject the voice description into input as a `(description)text` prefix (aligned with the VoxCPM `f"({control}){text}"` convention)
  const control = params.control?.trim();
  const input = control ? `(${control})${params.text}` : params.text;
  const format: TtsFormat = 'wav';
  const body: Record<string, unknown> = {
    model: params.model,
    input,
    // Private voice_xxx is resolved by MAP; temporary uploads and preset voices still use default + ref_audio.
    voice: params.voice?.trim() || 'default',
    response_format: format,
  };
  // Voice cloning: when reference audio is present, pass ref_audio through and upstream VoxCPM clones the voice from it
  if (params.refAudio) body.ref_audio = params.refAudio;
  // Guidance strength: send it only when the caller passes it explicitly (the default path omits it, so existing synthesis is not affected by upstream field compatibility)
  if (typeof params.cfg === 'number') body.cfg_value = params.cfg;
  // Denoise / text normalization: send only when enabled (officially a demo-side preprocess; we pass the fields through, and effect depends on upstream capability)
  if (params.denoise) body.denoise = true;
  if (params.normalize) body.do_normalize = true;
  const clientRequestID = params.clientRequestID?.trim() || createPlaygroundClientRequestID();
  const portalToken = getToken();
  const res = await fetch(`${CHAT_API_BASE}/v1/audio/speech`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.secret}`,
      ...(portalToken ? { 'X-Map-Portal-Token': `Bearer ${portalToken}` } : {}),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'X-Map-Playground-Experience': 'tts',
      'X-Request-Id': clientRequestID,
    },
    body: JSON.stringify(body),
    signal: params.signal,
  });
  // Success contract: 2xx + text/event-stream; otherwise read the JSON error body and map it to readable copy.
  const contentType = res.headers.get('Content-Type') ?? '';
  if (!res.ok || !contentType.toLowerCase().startsWith('text/event-stream')) {
    const text = await res.text().catch(() => '');
    throw new Error(mapAudioError(res.status, text));
  }
  const blob = await collectSpeechSSE(res);
  return { objectUrl: URL.createObjectURL(blob), format };
}

/** Aggregate WAV bytes from LIS `speech.audio.delta` events; `audio` is the live field, and historical `delta` is still accepted. */
async function collectSpeechSSE(response: Response): Promise<Blob> {
  if (!response.body) throw new Error('语音服务未返回可读取的流');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const audioChunks: Uint8Array[] = [];
  let buffered = '';
  let eventName = '';
  let dataLines: string[] = [];
  let completed = false;
  let streamError = '';

  const flushEvent = () => {
    if (dataLines.length === 0) {
      eventName = '';
      return;
    }
    const rawData = dataLines.join('\n');
    dataLines = [];
    let payload: {
      type?: string;
      audio?: string;
      delta?: string;
      error?: { message?: string };
      message?: string;
    };
    try {
      payload = JSON.parse(rawData) as typeof payload;
    } catch {
      eventName = '';
      throw new Error('语音服务返回了无法解析的流事件');
    }
    const type = payload.type ?? eventName;
    eventName = '';
    if (type === 'speech.audio.delta') {
      const audio = payload.audio ?? payload.delta;
      if (typeof audio !== 'string' || audio.length === 0) {
        throw new Error('语音服务返回了无效的音频片段');
      }
      audioChunks.push(decodeBase64Audio(audio));
      return;
    }
    if (type === 'speech.audio.done') {
      completed = true;
      return;
    }
    if (type === 'error' || type === 'speech.error') {
      streamError = payload.error?.message ?? payload.message ?? '语音服务处理失败';
    }
  };

  const processLine = (line: string) => {
    if (line === '') {
      flushEvent();
      return;
    }
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim();
      return;
    }
    if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trimStart());
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffered += decoder.decode(value, { stream: !done });
      let newlineIndex: number;
      while ((newlineIndex = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, newlineIndex).replace(/\r$/, '');
        buffered = buffered.slice(newlineIndex + 1);
        processLine(line);
      }
      if (done) break;
    }
    if (buffered.length > 0) processLine(buffered.replace(/\r$/, ''));
    flushEvent();
  } finally {
    reader.releaseLock();
  }

  if (streamError) throw new Error(streamError);
  if (!completed) throw new Error('语音生成未完成，请重试');
  if (audioChunks.length === 0) throw new Error('语音服务未返回音频内容');
  const blobParts = audioChunks.map((chunk) => {
    const copy = new Uint8Array(chunk.byteLength);
    copy.set(chunk);
    return copy.buffer;
  });
  return new Blob(blobParts, { type: 'audio/wav' });
}

function decodeBase64Audio(value: string): Uint8Array {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    throw new Error('语音服务返回了无效的音频数据');
  }
}

/** Map an upstream error response to user-readable copy (prefer OpenAI error.code, then fall back to the status code). */
function mapAudioError(status: number, rawText: string): string {
  let detail: string;
  let errorCode = '';
  try {
    const parsed = JSON.parse(rawText) as { error?: { code?: string; message?: string } };
    errorCode = parsed.error?.code ?? '';
    detail = parsed.error?.message ?? '';
  } catch {
    detail = rawText.slice(0, 200);
  }
  if (errorCode === 'voice_not_found') return '音色不存在或已失效，请重新选择';
  if (errorCode === 'model_not_found') return '模型不可用，请检查模型配置';
  if (errorCode === 'model_capability_mismatch') return '该模型不支持语音合成';
  if (status === 400) {
    return detail ? `请求失败：${detail}` : '所选模型可能不支持语音，请更换支持音频输出的模型';
  }
  if (status === 401) return 'API Key 无效或已失效，请重试';
  if (status === 404) return '模型不可用或不支持该能力';
  // 409: the target service does not match the speech-synthesis profile (contract §4.6)
  if (status === 409) return '所选模型不是语音合成服务，请在模型管理中确认其能力配置';
  // 413: the request body or reference audio exceeds the limit (contract §4.5: body 8 MiB / ref_audio 5 MiB after decoding)
  if (status === 413) return detail || '参考音频或合成文本过大，请缩短后重试';
  if (status === 429) return '请求过于频繁，请稍后再试';
  if (status === 502) return detail || '上游返回的语音流不符合预期，请稍后重试';
  if (status >= 500) return detail || '上游服务暂时不可用，请稍后重试';
  return detail || `请求失败（${status}）`;
}
