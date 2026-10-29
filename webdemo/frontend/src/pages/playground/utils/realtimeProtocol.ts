/**
 * MiniCPM-O 实时双工线协议（帧构造 + 下行事件归一化）。
 *
 * 与 L2 `/v1/realtime` 原样透传的 JSON text frame 一一对应，取自官方 realtime-session.js
 * 的 API V2 协议：session.init / input.append / response.output.delta(kind=...)。
 * 纯函数、无 DOM 依赖，便于单测；WS 连接与鉴权在 useRealtimeSession 中处理。
 */

/** 采样/生成配置（透传到 session.init.payload.config；profile v1 主用 length_penalty） */
export interface RealtimeConfig {
  length_penalty: number;
  max_tokens: number;
  temperature: number;
  max_kv_tokens?: number;
  tts_enabled?: boolean;
  vision_hd?: boolean;
}

/** session.init 额外参数 */
export interface SessionInitOptions {
  /** 参考音频（裸 base64），既作对话侧 ref 也作 TTS 侧 ref（对齐 demo 双字段） */
  refAudioBase64?: string;
  /** 图像切片数；video 模式默认 1，越大细节越多但更慢 */
  maxSliceNums?: number;
  ttsRefAudioBase64?: string;
}

/** 归一化后的下行事件 */
export type ServerEvent =
  | { kind: 'queue'; position?: number; estimatedWaitSeconds?: number; queueLength?: number }
  | { kind: 'queue_done' }
  | { kind: 'created'; sessionId?: string }
  | { kind: 'audio'; audio: string }
  | { kind: 'text'; text: string; endOfTurn: boolean }
  | { kind: 'listen'; text?: string }
  | { kind: 'closed'; reason?: string }
  | { kind: 'error'; message: string }
  | { kind: 'other' };

/** 下行原始帧的宽松形状（仅取用到的字段） */
interface RawServerFrame {
  type?: string;
  kind?: string;
  audio?: unknown;
  delta?: unknown;
  text?: unknown;
  end_of_turn?: unknown;
  reason?: unknown;
  session_id?: unknown;
  position?: unknown;
  estimated_wait_s?: unknown;
  queue_length?: unknown;
  message?: unknown;
  error?: { code?: string; message?: string } | string;
}

/** 构造 session.init 帧：system_prompt + config(length_penalty) + 可选 voice / 切片数。 */
export function buildSessionInit(
  system: string,
  config: RealtimeConfig,
  opts: SessionInitOptions = {},
): string {
  const payload: Record<string, unknown> = {
    system_prompt: system,
    config: {
      length_penalty: config.length_penalty,
      max_tokens: config.max_tokens,
      temperature: config.temperature,
      ...(config.max_kv_tokens == null ? {} : { max_kv_tokens: config.max_kv_tokens }),
      ...(config.tts_enabled == null ? {} : { tts_enabled: config.tts_enabled }),
      ...(config.vision_hd == null ? {} : { vision_hd: config.vision_hd }),
    },
  };
  if (opts.maxSliceNums != null) payload.max_slice_nums = opts.maxSliceNums;
  const voice: Record<string, string> = {};
  if (opts.refAudioBase64) {
    voice.ref_audio_base64 = opts.refAudioBase64;
    voice.tts_ref_audio_base64 = opts.refAudioBase64;
  }
  if (opts.ttsRefAudioBase64) voice.tts_ref_audio_base64 = opts.ttsRefAudioBase64;
  if (Object.keys(voice).length > 0) payload.voice = voice;
  return JSON.stringify({ type: 'session.init', payload });
}

/** 构造 input.append 帧：一段音频（+ 可选强制聆听 / 视频帧）。 */
export function buildInputAppend(
  audioBase64: string,
  opts: { forceListen?: boolean; videoFrames?: string[] } = {},
): string {
  const input: Record<string, unknown> = { audio: audioBase64 };
  if (opts.forceListen) input.force_listen = true;
  if (opts.videoFrames && opts.videoFrames.length > 0) input.video_frames = opts.videoFrames;
  return JSON.stringify({ type: 'input.append', input });
}

/** 构造 session.close 帧（主动挂断）。 */
export function buildSessionClose(reason: string): string {
  return JSON.stringify({ type: 'session.close', reason });
}

/**
 * 模型请求挂断的哨兵串。
 *
 * 线协议里没有"模型想结束通话"这类下行事件（只有客户端发 session.close，或上游通知
 * session.closed），模型说"那我们就先告别啦"只是自然语言、机器读不出意图。这里与模型约定：
 * 确认要结束时在回复末尾输出该标记，前端据此自动挂断，并从展示字幕中剔除标记本身。
 */
export const HANGUP_MARKER = '[[HANGUP]]';

/**
 * 追加挂断约定到系统提示词。
 *
 * 约定写在发送时而非用户可见的提示词输入框里：既不干扰用户自己写的场景提示词，
 * 也避免用户误删这段约定导致自动挂断失效。
 * @param system 用户配置的系统提示词
 * @returns 追加了挂断约定的提示词
 */
export function withHangupProtocol(system: string): string {
  return `${system.trim()}\n\n【结束通话约定】当用户明确表示要挂断、结束通话或告别时，先用一句话简短告别，然后在回复的最末尾输出标记 ${HANGUP_MARKER}。除此之外任何情况都不要输出这个标记；不要向用户解释或提及这个标记的存在。`;
}

/**
 * 模型"已答应挂断"的告别语判定词。
 *
 * 实测 MiniCPM-o **不会**稳定输出 HANGUP_MARKER（它只会用自然语言说"好的，我这就帮你挂断"），
 * 故标记之外必须有这层兜底：命中这些表述即视为模型已答应结束通话。
 * 均为"已在执行/已在告别"的说法，避免"你可以随时挂断"这类**提及**误触发。
 */
const HANGUP_PHRASES = [
  '帮你挂断',
  '为你挂断',
  '这就挂断',
  '马上挂断',
  '现在挂断',
  '结束通话',
  '结束本次通话',
  '先告别',
  '就先聊到这',
  '聊到这里',
  '再见啦',
  '拜拜啦',
  '祝你今天过得愉快',
];

/**
 * 判断模型回复是否表示"要挂断了"。
 *
 * 双通道：显式标记（模型听话时最准）或告别语兜底（模型不输出标记时仍能工作）。
 * @param text 模型本轮已累积的回复文本
 * @returns 是否应结束通话
 */
export function isHangupIntent(text: string): boolean {
  if (text.includes(HANGUP_MARKER)) return true;
  return HANGUP_PHRASES.some((p) => text.includes(p));
}

/**
 * 从字幕文本中剥离挂断标记。
 * @param text 模型回复的字幕文本（可能含标记）
 * @returns clean 去掉标记后的展示文本 / hangup 是否应结束通话
 */
export function stripHangupMarker(text: string): { clean: string; hangup: boolean } {
  const clean = text.includes(HANGUP_MARKER) ? text.split(HANGUP_MARKER).join('') : text;
  return { clean, hangup: isHangupIntent(text) };
}

/** 解析并归一化一条下行 JSON text frame；解析失败或未知类型 → { kind:'other' }。 */
export function parseServerEvent(data: string): ServerEvent {
  let msg: RawServerFrame;
  try {
    msg = JSON.parse(data) as RawServerFrame;
  } catch {
    return { kind: 'other' };
  }
  switch (msg.type || '') {
    case 'session.queued':
    case 'queued':
    case 'session.queue_update':
      return {
        kind: 'queue',
        position: numberValue(msg.position),
        estimatedWaitSeconds: numberValue(msg.estimated_wait_s),
        queueLength: numberValue(msg.queue_length),
      };
    case 'session.queue_done':
    case 'queue_done':
      return { kind: 'queue_done' };
    case 'session.created':
      return {
        kind: 'created',
        sessionId: typeof msg.session_id === 'string' ? msg.session_id : undefined,
      };
    case 'session.closed':
      return { kind: 'closed', reason: typeof msg.reason === 'string' ? msg.reason : undefined };
    case 'error':
      return { kind: 'error', message: errorMessage(msg) };
    case 'response.output_audio.delta':
      return audioEvent(msg.audio ?? msg.delta);
    case 'response.listen':
      return listenEvent(msg.text);
    case 'response.output_text.delta':
      return textEvent(msg.text ?? msg.delta, Boolean(msg.end_of_turn));
    case 'response.output.delta':
      if (msg.kind === 'audio') return audioEvent(msg.audio ?? msg.delta);
      if (msg.kind === 'listen') return listenEvent(msg.text);
      if (msg.kind === 'text') {
        return {
          kind: 'text',
          text: typeof msg.text === 'string' ? msg.text : '',
          endOfTurn: Boolean(msg.end_of_turn),
        };
      }
      return { kind: 'other' };
    default:
      return { kind: 'other' };
  }
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function listenEvent(text: unknown): ServerEvent {
  return typeof text === 'string' && text.trim()
    ? { kind: 'listen', text: text.trim() }
    : { kind: 'listen' };
}

function textEvent(text: unknown, endOfTurn: boolean): ServerEvent {
  return typeof text === 'string' && text ? { kind: 'text', text, endOfTurn } : { kind: 'other' };
}

/** base64 音频字段 → audio 事件；非字符串或空 → other。 */
function audioEvent(audio: unknown): ServerEvent {
  return typeof audio === 'string' && audio.length > 0
    ? { kind: 'audio', audio }
    : { kind: 'other' };
}

/** 从 error 帧提取可读消息（兼容 error 为对象或字符串）。 */
function errorMessage(msg: RawServerFrame): string {
  if (typeof msg.error === 'object' && msg.error?.message) return msg.error.message;
  if (typeof msg.error === 'string') return msg.error;
  if (typeof msg.message === 'string') return msg.message;
  return '实时服务返回错误';
}
