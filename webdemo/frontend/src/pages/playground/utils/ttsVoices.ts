/**
 * Voice catalog, reference-audio loading, and synthesis-parameter constants for experience-center "speech synthesis".
 *
 * Purpose: VoxCPM is a zero-shot clone model and has no named voice library — a voice can come only from reference audio (ref_audio), and the upstream
 * returns 4xx directly for an unknown voice, so the request always sends voice=default. "Preset demo voices" and "upload a clone" are the same ref_audio
 * path underneath, and differ only in where the audio comes from: the default voice (no ref_audio) / a preset voice (built-in wav → data URI) / an uploaded clone
 * (user upload → data URI). This module provides the voice catalog, loading of "preset wav → data URI", and synthesis-parameter constants. Frontend only.
 */

import type { MapVoiceResource } from '@/api/map';
import { arrayBufferToBase64, blobToPcm16kBase64 } from './audioEncode';

/** Sentinel for an uploaded clone: once selected, show the upload control, and ref_audio comes from the user upload */
export const VOICE_UPLOAD = '__upload__';

/** Default voice value: no ref_audio, and the upstream default pronunciation is used */
export const VOICE_DEFAULT = 'default';

/** Size cap for decoded reference audio (5 MiB, aligned with LIS contract §4.5; over the limit the upstream returns 413) */
export const REF_AUDIO_MAX_BYTES = 5 * 1024 * 1024;

/** Example copy */
export const TTS_SAMPLES = [
  '欢迎来到面壁智能 API 平台，这里可以体验语音合成的自然表现力。',
  '今天天气晴朗，微风拂面，正适合出门散步、感受大自然的美好。',
  '尊敬的用户您好，您的订单已发货，预计三天内送达，请注意查收。',
];

/** Synthesis text cap */
export const TTS_MAX_LEN = 2000;

/** Guidance strength (cfg_value) range: higher sticks closer to the prompt and reference voice, lower is freer (aligned with the official 1.0–3.0) */
export const TTS_CFG_MIN = 1;
export const TTS_CFG_MAX = 3;
export const TTS_CFG_STEP = 0.1;
export const TTS_CFG_DEFAULT = 2;

/** Reference-audio duration cap (seconds), aligned with the official VoxCPM2 demo's 50s */
export const TTS_REF_MAX_SECONDS = 50;

/** One selectable voice */
export interface TtsVoice {
  value: string;
  label: string;
  /** Reference-audio URL of a preset voice (relative to public, prefixed by BASE_URL); empty for the default and upload items */
  refPath?: string;
}

/**
 * Whether a private voice has finished its ownership check.
 *
 * @param voice current selection
 * @param savedVoices voices visible to the currently logged-in user
 * @param listLoaded whether the voice list loaded successfully
 * @returns a preset voice is always usable; a private voice can be submitted only when the list loaded successfully and it is in the list
 */
export function isSavedVoiceReady(
  voice: string,
  savedVoices: MapVoiceResource[],
  listLoaded: boolean,
): boolean {
  if (!voice.startsWith('voice_')) return true;
  return listLoaded && savedVoices.some((savedVoice) => savedVoice.id === voice);
}

/** When permission is revoked or a private voice is no longer valid, collapse the current selection to a voice that can be submitted safely. */
export function resolveTtsVoice(
  voice: string,
  canUseCustomVoice: boolean,
  savedVoices: MapVoiceResource[],
  listLoaded: boolean,
): string {
  if (!canUseCustomVoice && (voice === VOICE_UPLOAD || voice.startsWith('voice_'))) {
    return VOICE_DEFAULT;
  }
  if (
    voice.startsWith('voice_') &&
    listLoaded &&
    !savedVoices.some((savedVoice) => savedVoice.id === voice)
  ) {
    return VOICE_DEFAULT;
  }
  return voice;
}

/**
 * Voice catalog: default voice + preset demo voices + uploaded clone.
 * value is only a frontend picker id and **does not enter the request body** (the request always sends voice=default); voice differences come entirely from the reference audio refPath points at.
 * Preset assets live in portal `public/voices/`; when operations adds an asset, append it here.
 */
export const TTS_VOICES: TtsVoice[] = [
  { value: VOICE_DEFAULT, label: 'voiceDefault' },
  { value: 'demo-a', label: 'voiceDemoFemale', refPath: 'voices/demo-a.wav' },
  { value: 'demo-b', label: 'voiceDemoMale', refPath: 'voices/demo-b.wav' },
  { value: VOICE_UPLOAD, label: 'voiceUpload' },
];

/**
 * Return the preset voices the current mode can show.
 *
 * @param mode ordinary generation, or upload-a-clone mode
 * @param canUseCustomVoice whether the current user may use the custom-voice entry
 * @returns ordinary generation always includes the default and preset voices; upload-a-clone is shown only to an authorized user
 */
export function ttsVoicesForMode(
  mode: 'generate' | 'clone',
  canUseCustomVoice: boolean,
): TtsVoice[] {
  if (mode === 'generate') return TTS_VOICES.filter((voice) => voice.value !== VOICE_UPLOAD);
  return canUseCustomVoice ? TTS_VOICES.filter((voice) => voice.value === VOICE_UPLOAD) : [];
}

/** When permission is revoked while the page stays open, fall back to ordinary generation immediately, so the custom-voice control is not kept on screen. */
export function resolveTtsMode(
  mode: 'generate' | 'clone',
  canUseCustomVoice: boolean,
): 'generate' | 'clone' {
  return mode === 'clone' && !canUseCustomVoice ? 'generate' : mode;
}

/** data-URI cache of preset-voice reference audio (so repeated synthesis does not fetch the same asset again) */
const refCache = new Map<string, string>();
const realtimeRefCache = new Map<string, string>();

/**
 * Load a preset voice's reference audio and convert it to `data:audio/wav;base64,...`.
 *
 * A data URI is chosen over passing a URL through: the contract accepts only an inline Base64 WAV, and no URL (the upstream will not fetch an external address).
 * An asset over 5 MiB is rejected by the upstream with 413, so it is blocked here first with readable copy.
 * @param refPath path relative to public (such as `voices/demo-a.wav`)
 * @returns a data URI that can be passed as ref_audio
 * @throws Error when the asset fails to load or exceeds the size cap (with readable copy)
 */
export async function fetchRefAudioDataUri(refPath: string): Promise<string> {
  const cached = refCache.get(refPath);
  if (cached) return cached;
  const url = `${import.meta.env.BASE_URL}${refPath}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('预置音色素材加载失败，请稍后重试或改用其他音色');
  const buf = await res.arrayBuffer();
  if (buf.byteLength > REF_AUDIO_MAX_BYTES) {
    throw new Error('该预置音色素材过大（超过 5 MiB），请改用其他音色或上传较短的参考音频');
  }
  const dataUri = `data:audio/wav;base64,${arrayBufferToBase64(buf)}`;
  refCache.set(refPath, dataUri);
  return dataUri;
}

/**
 * Load and convert realtime duplex reference audio to 16kHz mono raw float32 PCM base64.
 *
 * @param refPath path relative to public
 * @returns reference-audio base64 that matches the Realtime voice protocol
 */
export async function fetchRealtimeRefAudioBase64(refPath: string): Promise<string> {
  const cached = realtimeRefCache.get(refPath);
  if (cached) return cached;
  const url = `${import.meta.env.BASE_URL}${refPath}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('预置音色素材加载失败，请稍后重试或改用其他音色');
  const base64 = await blobToPcm16kBase64(await res.blob());
  realtimeRefCache.set(refPath, base64);
  return base64;
}

// ---------- Voice description (Control Instruction) ----------

/** Voice-description sentinel: none (natural pronunciation, no control prefix injected).
 *  Must be a non-empty string — Radix Select's SelectItem value does not allow an empty string (the empty string is reserved for clearing the selection and showing the placeholder). */
export const CONTROL_NONE = 'none';

/** Voice-description sentinel: custom (expand the input, and the user types freely) */
export const CONTROL_CUSTOM = '__custom__';

/** One voice-description preset */
export interface ControlPreset {
  value: string;
  label: string;
  /** Voice-description text (injected into input with a `(control)` prefix); empty for sentinel items */
  control: string;
  /** Matching example target copy (filled into the synthesis text when a preset is selected, so it can be previewed quickly) */
  sampleText?: string;
}

/**
 * Voice-description preset catalog: none / several style presets / custom.
 * Preset text is aligned with the official VoxCPM2 demo's voice-description examples (including dialects); operations can append more here.
 */
export const TTS_CONTROL_PRESETS: ControlPreset[] = [
  { value: CONTROL_NONE, label: 'voiceControlNone', control: '' },
  {
    value: 'gentle-female',
    label: 'voiceControlGentleFemale',
    control: '年轻女性，温柔甜美，语速平缓',
    sampleText: '欢迎回来，很高兴又见到你，今天过得怎么样呀？',
  },
  {
    value: 'grumpy-male',
    label: 'voiceControlGrumpyMale',
    control: '暴躁的中年男声，语速快，充满无奈和愤怒',
    sampleText: '踩离合！踩刹车啊！你往哪儿开呢？前面是树你看不见吗？',
  },
  {
    value: 'empress',
    label: 'voiceControlEmpress',
    control: '中老年女性，声音低沉阴冷，语速缓慢而有力，字字深思熟虑，带有深不可测的城府与威慑感。',
    sampleText: '哀家在这深宫待了四十年，什么风浪没见过？你以为瞒得过哀家？',
  },
  {
    value: 'cantonese',
    label: 'voiceControlCantonese',
    control: '粤语，中年男性，语气平淡',
    sampleText: '伙計，唔該一個A餐，凍奶茶少甜！',
  },
  {
    value: 'henan',
    label: 'voiceControlHenan',
    control: '河南话，接地气的大叔',
    sampleText: '恁这是弄啥嘞？晌午吃啥饭？',
  },
  { value: CONTROL_CUSTOM, label: 'voiceControlCustom', control: '' },
];

/** One voice-description usage example (for the "view examples" dialog, aligned with the official examples and dialect guide) */
export interface ControlExample {
  title: string;
  control: string;
  targetText: string;
  /** Dialect item: a wrong example (Mandarin original), contrasted with targetText to show "a dialect must be written in dialect wording" */
  wrongText?: string;
}

/** Voice-description examples (aligned with the official demo: role-play + dialect generation guide) */
export const TTS_CONTROL_EXAMPLES: ControlExample[] = [
  {
    title: 'voiceExampleEmpress',
    control: '中老年女性，声音低沉阴冷，语速缓慢而有力，字字深思熟虑，带有深不可测的城府与威慑感。',
    targetText: '哀家在这深宫待了四十年，什么风浪没见过？你以为瞒得过哀家？',
  },
  {
    title: 'voiceExampleDrivingCoach',
    control: '暴躁的中年男声，语速快，充满无奈和愤怒',
    targetText:
      '踩离合！踩刹车啊！你往哪儿开呢？前面是树你看不见吗？我教了你八百遍了，打死方向盘！',
  },
  {
    title: 'voiceExampleCantonese',
    control: '粤语，中年男性，语气平淡',
    targetText: '伙計，唔該一個A餐，凍奶茶少甜！',
    wrongText: '伙计，麻烦来一个A餐，冻奶茶少甜！',
  },
  {
    title: 'voiceExampleHenan',
    control: '河南话，接地气的大叔',
    targetText: '恁这是弄啥嘞？晌午吃啥饭？',
    wrongText: '你这是在干什么呢？中午吃什么饭？',
  },
];
