/**
 * MAP 体验中心「语音合成（TTS）」API。
 *
 * 用途：TTS 合成走 L2 的 OpenAI 兼容 `/v1/audio/speech`（对接 LIS VoxCPM2，契约 voxcpm_speech@2），
 * 体验中心请求 WAV；L2 会强制注入 stream=true 并以 SSE 返回。前端逐段聚合
 * `speech.audio.delta` 中现网的 `audio` 字段，兼容历史 `delta` 字段，在 `speech.audio.done` 后生成
 * 可播放的音频 Blob。该终态同时是 LIS 返回权威 token usage 的唯一计量点，因此不再使用无 usage 的
 * unary 路径。
 *
 * 音色：VoxCPM 无命名音色库、上游对未知 voice 直接 4xx，故 `voice` 恒发 `default`，音色差异一律由
 * `ref_audio` 参考音频承载（零样本克隆）。参考音频出于安全只接受内联 Base64 WAV
 * （`data:audio/wav;base64,...`），不支持任何 URL，解码后上限 5 MiB。
 *
 * 声音描述（control，Control Instruction）以 `(描述)` 前缀注入 input，VoxCPM 原生解析：无参考音频
 * 即「声音设计」，有参考音频即在克隆基础上叠加情绪/语速/风格。引导强度（cfg → cfg_value）、参考音频
 * 降噪（denoise）、文本规范化（do_normalize）按需下发——契约未列这三个字段，我方作透传，是否生效
 * 取决于上游 LIS 能力（M0 契约项），故仅在用户显式调整时才带上，默认路径不携带契约外字段。
 * 实时全双工语音对话不走本模块，改由 realtime WS 通道（utils/realtimeConnection.ts）承载。
 *
 * L2 用 map[string]any 原样透传 body 到 LIS。**不复用** mapRequest（后者解 L3 信封），
 * 以明文 API Key 作 Bearer。
 *
 * 安全：secret（明文 lis_sk_xxx）仅由调用方内存传入，本模块不持久化、不打印。
 */

import { CHAT_API_BASE } from './chat';
import { createPlaygroundClientRequestID } from './chat';
import { getToken } from './request';

/** 体验中心使用的输出格式（平台强制 SSE，仅支持 WAV） */
export type TtsFormat = 'wav';

/** TTS 合成结果：可直接播放/下载的 Object URL（调用方负责 revoke） */
export interface TtsResult {
  /** 由二进制音频 blob 生成的 Object URL */
  objectUrl: string;
  /** 实际输出格式，用于派生下载文件名 */
  format: TtsFormat;
}

/** TTS 合成入参（私有音色使用 voice_xxx；临时参考音频使用 refAudio） */
export interface SynthesizeParams {
  model: string;
  secret: string;
  /** 待合成文本（Target Text） */
  text: string;
  /** 平台私有音色 ID；voice_xxx 由 MAP 校验归属后解析 */
  voice?: string;
  /**
   * 声音描述 / 风格控制（Control Instruction，可选）。非空时以 `(描述)` 前缀注入 input，
   * VoxCPM 原生解析：无参考音频即凭描述造声（声音设计），有参考音频即叠加风格。
   */
  control?: string;
  /**
   * 参考音频 data URI（`data:audio/wav;base64,...`），用于语音复刻；缺省则不克隆。
   * 契约只允许内联 Base64 WAV，不接受 http/https/file URL；解码后不得超过 5 MiB。
   */
  refAudio?: string;
  /** 引导强度 cfg_value（越高越贴合提示/参考音色）。缺省则不下发，沿用上游默认 */
  cfg?: number;
  /**
   * 参考音频降噪增强（denoise）。仅在为 true 时下发 denoise=true；官方 demo 侧为独立预处理，
   * 我方作为字段透传给上游，是否真正生效取决于 LIS 能力（M0 契约项）。
   */
  denoise?: boolean;
  /**
   * 文本规范化（do_normalize）。仅在为 true 时下发 do_normalize=true；同为透传字段，
   * 生效与否取决于上游（M0 契约项）。
   */
  normalize?: boolean;
  /** 体验中心关联 ID；未传时自动生成 */
  clientRequestID?: string;
  signal?: AbortSignal;
}

/**
 * 文本转语音（TTS）。走 L2 `/v1/audio/speech`；平台强制 SSE，并在浏览器内聚合为完整音频。
 * @returns 可播放/下载的 Object URL 与实际格式（调用方用完须 URL.revokeObjectURL）
 * @throws Error 上游非 2xx 或未返回音频（含可读文案）
 */
export async function synthesizeSpeech(params: SynthesizeParams): Promise<TtsResult> {
  // 声音描述以 `(描述)文本` 前缀注入 input（对齐 VoxCPM `f"({control}){text}"` 约定）
  const control = params.control?.trim();
  const input = control ? `(${control})${params.text}` : params.text;
  const format: TtsFormat = 'wav';
  const body: Record<string, unknown> = {
    model: params.model,
    input,
    // 私有 voice_xxx 由 MAP 解析；临时上传/预置音色仍使用 default + ref_audio。
    voice: params.voice?.trim() || 'default',
    response_format: format,
  };
  // 语音复刻：带参考音频时透传 ref_audio，上游 VoxCPM 据此克隆音色
  if (params.refAudio) body.ref_audio = params.refAudio;
  // 引导强度：仅在调用方明确传入时下发（默认路径不带，保护既有可用合成不受上游字段兼容性影响）
  if (typeof params.cfg === 'number') body.cfg_value = params.cfg;
  // 降噪 / 文本规范化：仅在开启时下发（官方为 demo 侧预处理，我方作透传字段，生效取决于上游能力）
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
  // 成功契约：2xx + text/event-stream；否则读 JSON 错误正文映射为可读文案。
  const contentType = res.headers.get('Content-Type') ?? '';
  if (!res.ok || !contentType.toLowerCase().startsWith('text/event-stream')) {
    const text = await res.text().catch(() => '');
    throw new Error(mapAudioError(res.status, text));
  }
  const blob = await collectSpeechSSE(res);
  return { objectUrl: URL.createObjectURL(blob), format };
}

/** 从 LIS `speech.audio.delta` 事件聚合 WAV 字节；`audio` 为现网字段，兼容历史 `delta`。 */
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

/** 把上游错误响应映射为用户可读文案（优先按 OpenAI error.code，再回退到状态码）。 */
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
  // 409：目标服务与语音合成 profile 不匹配（契约 §4.6）
  if (status === 409) return '所选模型不是语音合成服务，请在模型管理中确认其能力配置';
  // 413：请求体或参考音频超过限制（契约 §4.5：body 8 MiB / ref_audio 解码后 5 MiB）
  if (status === 413) return detail || '参考音频或合成文本过大，请缩短后重试';
  if (status === 429) return '请求过于频繁，请稍后再试';
  if (status === 502) return detail || '上游返回的语音流不符合预期，请稍后重试';
  if (status >= 500) return detail || '上游服务暂时不可用，请稍后重试';
  return detail || `请求失败（${status}）`;
}
