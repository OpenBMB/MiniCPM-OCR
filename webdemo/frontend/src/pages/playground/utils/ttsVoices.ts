/**
 * 体验中心「语音合成」音色目录、参考音频加载与合成参数常量。
 *
 * 用途：VoxCPM 是零样本克隆模型，无命名音色库——音色只能来自参考音频（ref_audio），且上游对未知
 * voice 直接 4xx，故请求恒发 voice=default。「预置示范音色」与「上传复刻」底层同为一条 ref_audio
 * 路，仅音频来源不同：默认音色（不带 ref_audio）/ 预置音色（内置 wav → data URI）/ 上传复刻
 * （用户上传 → data URI）。本模块提供音色目录、「预置 wav → data URI」的加载与合成参数常量。纯前端。
 */

import type { MapVoiceResource } from '@/api/map';
import { arrayBufferToBase64, blobToPcm16kBase64 } from './audioEncode';

/** 上传复刻哨兵值：选中后展示上传控件，ref_audio 来自用户上传 */
export const VOICE_UPLOAD = '__upload__';

/** 默认音色值：不带 ref_audio，走上游默认发音 */
export const VOICE_DEFAULT = 'default';

/** 参考音频解码后大小上限（5 MiB，对齐 LIS 契约 §4.5，超限上游返回 413） */
export const REF_AUDIO_MAX_BYTES = 5 * 1024 * 1024;

/** 示例文案 */
export const TTS_SAMPLES = [
  '欢迎来到面壁智能 API 平台，这里可以体验语音合成的自然表现力。',
  '今天天气晴朗，微风拂面，正适合出门散步、感受大自然的美好。',
  '尊敬的用户您好，您的订单已发货，预计三天内送达，请注意查收。',
];

/** 合成文本上限 */
export const TTS_MAX_LEN = 2000;

/** 引导强度（cfg_value）范围：越高越贴合提示/参考音色，越低越自由（对齐官方 1.0–3.0） */
export const TTS_CFG_MIN = 1;
export const TTS_CFG_MAX = 3;
export const TTS_CFG_STEP = 0.1;
export const TTS_CFG_DEFAULT = 2;

/** 参考音频时长上限（秒），对齐官方 VoxCPM2 demo 的 50s */
export const TTS_REF_MAX_SECONDS = 50;

/** 一个可选音色 */
export interface TtsVoice {
  value: string;
  label: string;
  /** 预置音色的参考音频地址（相对 public，经 BASE_URL 前缀）；默认/上传项为空 */
  refPath?: string;
}

/**
 * 判断私有音色是否已完成归属校验。
 *
 * @param voice 当前选择值
 * @param savedVoices 当前登录用户可见的音色
 * @param listLoaded 音色列表是否已成功加载
 * @returns 预置音色始终可用；私有音色只有在列表成功加载且命中时才可提交
 */
export function isSavedVoiceReady(
  voice: string,
  savedVoices: MapVoiceResource[],
  listLoaded: boolean,
): boolean {
  if (!voice.startsWith('voice_')) return true;
  return listLoaded && savedVoices.some((savedVoice) => savedVoice.id === voice);
}

/** 权限收回或私有音色失效时，将当前选择收敛到可安全提交的音色。 */
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
 * 音色目录：默认音色 + 预置示范音色 + 上传复刻。
 * value 仅作前端选择器标识，**不进请求体**（请求恒发 voice=default）；音色差异全靠 refPath 指向的参考音频。
 * 预置素材放在 portal `public/voices/`，运营补充素材时在此追加即可。
 */
export const TTS_VOICES: TtsVoice[] = [
  { value: VOICE_DEFAULT, label: 'voiceDefault' },
  { value: 'demo-a', label: 'voiceDemoFemale', refPath: 'voices/demo-a.wav' },
  { value: 'demo-b', label: 'voiceDemoMale', refPath: 'voices/demo-b.wav' },
  { value: VOICE_UPLOAD, label: 'voiceUpload' },
];

/**
 * 返回当前模式可展示的预置音色。
 *
 * @param mode 普通生成或上传复刻模式
 * @param canUseCustomVoice 当前用户是否可使用自定义音色入口
 * @returns 普通生成始终包含默认和预置音色；上传复刻仅对获授权用户展示
 */
export function ttsVoicesForMode(
  mode: 'generate' | 'clone',
  canUseCustomVoice: boolean,
): TtsVoice[] {
  if (mode === 'generate') return TTS_VOICES.filter((voice) => voice.value !== VOICE_UPLOAD);
  return canUseCustomVoice ? TTS_VOICES.filter((voice) => voice.value === VOICE_UPLOAD) : [];
}

/** 权限在页面停留期间被收回时立即回退普通生成，避免继续显示自定义音色控件。 */
export function resolveTtsMode(
  mode: 'generate' | 'clone',
  canUseCustomVoice: boolean,
): 'generate' | 'clone' {
  return mode === 'clone' && !canUseCustomVoice ? 'generate' : mode;
}

/** 预置音色参考音频的 data URI 缓存（避免重复合成时反复 fetch 同一素材） */
const refCache = new Map<string, string>();
const realtimeRefCache = new Map<string, string>();

/**
 * 加载预置音色的参考音频并转为 `data:audio/wav;base64,...`。
 *
 * 选 data URI 而非直传 URL：契约只接受内联 Base64 WAV，不接受任何 URL（上游不会去拉取外部地址）。
 * 素材超过 5 MiB 会被上游 413 拒绝，故此处先行拦截给出可读文案。
 * @param refPath public 相对路径（如 `voices/demo-a.wav`）
 * @returns 可作 ref_audio 传入的 data URI
 * @throws Error 素材加载失败或超过大小上限（含可读文案）
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
 * 加载并转换实时双工参考音频为 16kHz mono 裸 float32 PCM base64。
 *
 * @param refPath public 相对路径
 * @returns 符合 Realtime voice 协议的参考音频 base64
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

// ---------- 声音描述（Control Instruction） ----------

/** 声音描述哨兵值：不使用（自然发音，不注入 control 前缀）。
 *  注意用非空串——Radix Select 的 SelectItem value 不允许空字符串（空串专用于清空选择显示占位）。 */
export const CONTROL_NONE = 'none';

/** 声音描述哨兵值：自定义（展开输入框，用户自由填写） */
export const CONTROL_CUSTOM = '__custom__';

/** 一个声音描述预设 */
export interface ControlPreset {
  value: string;
  label: string;
  /** 声音描述文本（以 `(control)` 前缀注入 input）；哨兵项为空串 */
  control: string;
  /** 配套示例目标文案（选中预设时一并填入合成文本，便于快速试听） */
  sampleText?: string;
}

/**
 * 声音描述预设目录：不使用 / 若干风格预设 / 自定义。
 * 预设文本对齐官方 VoxCPM2 demo 的声音描述示例（含方言）；运营可在此追加。
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

/** 一条声音描述用法示例（用于「查看示例」弹窗，对齐官方示例与方言指南） */
export interface ControlExample {
  title: string;
  control: string;
  targetText: string;
  /** 方言项：错误示范（普通话原文），与 targetText 对比说明「方言要写方言词句」 */
  wrongText?: string;
}

/** 声音描述示例（对齐官方 demo：角色扮演 + 方言生成指南） */
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
