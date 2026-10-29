/**
 * MiniCPM-O realtime duplex wire protocol (frame construction + downlink event normalization).
 *
 * One-to-one with the JSON text frames L2 `/v1/realtime` forwards as-is, taken from the API V2 protocol in the official realtime-session.js:
 * session.init / input.append / response.output.delta(kind=...).
 * Pure functions, no DOM dependency, so they are easy to unit test; the WS connection and auth are handled in useRealtimeSession.
 */

/** Sampling and generation config (forwarded to session.init.payload.config; profile v1 mainly uses length_penalty) */
export interface RealtimeConfig {
  length_penalty: number;
  max_tokens: number;
  temperature: number;
  max_kv_tokens?: number;
  tts_enabled?: boolean;
  vision_hd?: boolean;
}

/** Extra session.init parameters */
export interface SessionInitOptions {
  /** Reference audio (raw base64), used both as the conversation-side ref and the TTS-side ref (matching the demo's two fields) */
  refAudioBase64?: string;
  /** Image slice count; video mode defaults to 1. More slices mean more detail and more latency */
  maxSliceNums?: number;
  ttsRefAudioBase64?: string;
}

/** Normalized downlink event */
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

/** Loose shape of a raw downlink frame (only the fields that are used) */
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

/** Build a session.init frame: system_prompt + config(length_penalty) + optional voice / slice count. */
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

/** Build an input.append frame: one audio segment (+ optional force-listen / video frame). */
export function buildInputAppend(
  audioBase64: string,
  opts: { forceListen?: boolean; videoFrames?: string[] } = {},
): string {
  const input: Record<string, unknown> = { audio: audioBase64 };
  if (opts.forceListen) input.force_listen = true;
  if (opts.videoFrames && opts.videoFrames.length > 0) input.video_frames = opts.videoFrames;
  return JSON.stringify({ type: 'input.append', input });
}

/** Build a session.close frame (hang up on purpose). */
export function buildSessionClose(reason: string): string {
  return JSON.stringify({ type: 'session.close', reason });
}

/**
 * Sentinel string for the model requesting a hang-up.
 *
 * The wire protocol has no downlink event for "the model wants to end the call" (only the client sends session.close, or the upstream notifies
 * session.closed). The model saying "then let's say goodbye for now" is only natural language, and a machine cannot read the intent. The convention with the model is:
 * when it confirms it should end, it outputs this marker at the end of the reply. The frontend hangs up from that, and strips the marker itself from the displayed caption.
 */
export const HANGUP_MARKER = '[[HANGUP]]';

/**
 * Append the hang-up convention to the system prompt.
 *
 * The convention is written at send time, not in the prompt box the user sees: it does not interfere with the scene prompt the user wrote,
 * and it also avoids the user deleting this convention by mistake and disabling automatic hang-up.
 * @param system system prompt configured by the user
 * @returns the prompt with the hang-up convention appended
 */
export function withHangupProtocol(system: string): string {
  return `${system.trim()}\n\n【结束通话约定】当用户明确表示要挂断、结束通话或告别时，先用一句话简短告别，然后在回复的最末尾输出标记 ${HANGUP_MARKER}。除此之外任何情况都不要输出这个标记；不要向用户解释或提及这个标记的存在。`;
}

/**
 * Phrases that decide the model "has agreed to hang up".
 *
 * Measured behavior: MiniCPM-o does **not** stably output HANGUP_MARKER (it only says in natural language "okay, I'll hang up for you now"),
 * so there must be this fallback besides the marker: hitting these phrases counts as the model having agreed to end the call.
 * They are all "already doing it / already saying goodbye" phrasings, so a **mention** such as "you can hang up anytime" does not trigger it.
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
 * Whether the model reply means "about to hang up".
 *
 * Two channels: the explicit marker (most accurate when the model follows instructions) or the goodbye-phrase fallback (still works when the model does not output the marker).
 * @param text reply text accumulated for this model turn
 * @returns whether the call should end
 */
export function isHangupIntent(text: string): boolean {
  if (text.includes(HANGUP_MARKER)) return true;
  return HANGUP_PHRASES.some((p) => text.includes(p));
}

/**
 * Strip the hang-up marker from caption text.
 * @param text caption text of the model reply (may contain the marker)
 * @returns clean display text with the marker removed / hangup whether the call should end
 */
export function stripHangupMarker(text: string): { clean: string; hangup: boolean } {
  const clean = text.includes(HANGUP_MARKER) ? text.split(HANGUP_MARKER).join('') : text;
  return { clean, hangup: isHangupIntent(text) };
}

/** Parse and normalize one downlink JSON text frame; a parse failure or an unknown type → { kind:'other' }. */
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

/** A base64 audio field → an audio event; a non-string or empty → other. */
function audioEvent(audio: unknown): ServerEvent {
  return typeof audio === 'string' && audio.length > 0
    ? { kind: 'audio', audio }
    : { kind: 'other' };
}

/** Extract a readable message from an error frame (compatible with error as an object or a string). */
function errorMessage(msg: RawServerFrame): string {
  if (typeof msg.error === 'object' && msg.error?.message) return msg.error.message;
  if (typeof msg.error === 'string') return msg.error;
  if (typeof msg.message === 'string') return msg.message;
  return '实时服务返回错误';
}
