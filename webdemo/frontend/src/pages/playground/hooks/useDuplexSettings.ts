/**
 * 实时音视频（双工）参数状态 Hook。
 *
 * 用途：集中管理双工通话的全部可调参数（对齐 MiniCPM-o demo）——对话模式、音色、
 * 系统提示词、TTS 开关、Length Penalty、Max Tokens、Temperature、播放延迟、麦克风/扬声器、
 * 参考音频（音色克隆）。以单对象 + patch 收敛，供页面编排与请求组装。
 */

import { useAppStore, type AppLocale } from '@map/store';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** 通用选项 */
export interface DuplexOption {
  value: string;
  label: string;
}

/** 双工音色选项，包含声音要求和可选的参考音频素材。 */
export interface DuplexVoiceOption extends DuplexOption {
  instruction: string;
  instructionEn: string;
  refPath?: string;
}

export type DuplexLanguage = 'zh' | 'en';

/** 双工语言来源：跟随界面语言，或由用户在双工面板中手动指定。 */
export type DuplexLanguageMode = 'auto' | 'manual';

/** 官方 Demo 支持的界面/提示词语言。 */
export const LANGUAGES: DuplexOption[] = [
  { value: 'zh', label: 'languageChinese' },
  { value: 'en', label: 'languageEnglish' },
];

/** 对话模式（字段名 audioSource 为兼容已有持久化配置保留） */
export const SOURCES: DuplexOption[] = [
  { value: 'mic', label: 'audioDuplex' },
  { value: 'both', label: 'videoDuplex' },
];

/** 对话音色 */
export const VOICES: DuplexVoiceOption[] = [
  {
    value: 'female_warm',
    label: 'warmFemaleVoice',
    instruction: '声音温柔、柔和，语速平缓，语气亲切。',
    instructionEn: 'The voice is warm and gentle, with a calm pace and a friendly tone.',
    refPath: 'voices/demo-a.wav',
  },
  {
    value: 'male_general',
    label: 'steadyMaleVoice',
    instruction: '声音沉稳、低沉，语气自然，表达清晰。',
    instructionEn: 'The voice is steady and deep, with a natural tone and clear delivery.',
    refPath: 'voices/demo-b.wav',
  },
  {
    value: 'female_lively',
    label: 'livelyFemaleVoice',
    instruction: '声音明亮、活泼，语气有感染力，交流自然。',
    instructionEn: 'The voice is bright and lively, with an engaging tone and natural delivery.',
    refPath: 'voices/demo-a.wav',
  },
];

/** 官方 MiniCPM-o-Demo 预设原文。 */
export const OFFICIAL_AUDIO_DUPLEX_PROMPT =
  '扮演一个具有以上声音特征的助手。请认真、高质量地回复用户的问题。请用高自然度的方式和用户聊天。你处于双工模式，可以一边听、一边说。你是由面壁智能开发的人工智能助手：面壁小钢炮。';
export const OFFICIAL_AUDIO_DUPLEX_ENGLISH_PROMPT =
  "Act as an assistant with the voice characteristics described above. Respond to the user's questions thoughtfully and with high quality. Chat with the user in a highly natural manner. You are in duplex mode, so you can listen and speak at the same time. You are ModelBest Xiao Gang Pao, an AI assistant developed by ModelBest Intelligence.";
export const OFFICIAL_OMNI_PROMPT = 'Streaming Omni Conversation.';

/** 场景预设 → 系统提示词；内容对应 MiniCPM-o-Demo/assets/presets。 */
export const SCENES = [
  {
    value: 'audio_chinese_call',
    label: 'sceneAudioChinese',
    system: OFFICIAL_AUDIO_DUPLEX_PROMPT,
    language: 'zh' as const,
  },
  {
    value: 'omni_chinese_call',
    label: 'sceneVideoChinese',
    system: OFFICIAL_OMNI_PROMPT,
    language: 'zh' as const,
  },
  {
    value: 'audio_english_call',
    label: 'sceneAudioEnglish',
    system: OFFICIAL_AUDIO_DUPLEX_ENGLISH_PROMPT,
    language: 'en' as const,
  },
  {
    value: 'omni_english_call',
    label: 'sceneVideoEnglish',
    system: OFFICIAL_OMNI_PROMPT,
    language: 'en' as const,
  },
];

export function promptForAudioSource(
  source: string,
  language: DuplexLanguage = 'zh',
): { scene: string; system: string; language: DuplexLanguage } {
  if (source === 'both') {
    return language === 'en'
      ? { scene: 'omni_english_call', system: OFFICIAL_OMNI_PROMPT, language }
      : { scene: 'omni_chinese_call', system: OFFICIAL_OMNI_PROMPT, language };
  }
  return language === 'en'
    ? { scene: 'audio_english_call', system: OFFICIAL_AUDIO_DUPLEX_ENGLISH_PROMPT, language }
    : { scene: 'audio_chinese_call', system: OFFICIAL_AUDIO_DUPLEX_PROMPT, language };
}

/** 双工全部参数 */
export interface DuplexSettings {
  audioSource: string;
  voice: string;
  scene: string;
  language: DuplexLanguage;
  languageMode: DuplexLanguageMode;
  system: string;
  outputAudio: boolean;
  lengthPenalty: number;
  maxTokens: number;
  maxKvTokens: number;
  temperature: number;
  ttsEnabled: boolean;
  visionHD: boolean;
  playbackDelay: number;
  responseLengthPreset: 'detail' | 'balanced' | 'concise';
  subtitleHeightPercent: number;
  subtitleBottomOpacity: number;
  subtitleTopOpacity: number;
  micDeviceId: string;
  speakerDeviceId: string;
  /** 参考音频（音色克隆）裸 base64 */
  refAudio?: string;
  refAudioName?: string;
  ttsRefAudio?: string;
  ttsRefAudioName?: string;
}

const LEGACY_SYSTEM_PROMPTS = new Set([
  '你是乐于助人的智能语音助手，用简洁自然的口语回答。',
  '你是专业耐心的客服，用礼貌简洁的口语解答用户问题。',
  '你是温暖的陪伴者，用亲切自然的口语回应用户。',
  '你是实时翻译助手，将用户的话翻译为目标语言并用口语表达。',
]);

function languageForLocale(locale: AppLocale): DuplexLanguage {
  return locale === 'en-US' ? 'en' : 'zh';
}

const OFFICIAL_SYSTEM_PROMPTS = new Set([
  OFFICIAL_AUDIO_DUPLEX_PROMPT,
  OFFICIAL_AUDIO_DUPLEX_ENGLISH_PROMPT,
  OFFICIAL_OMNI_PROMPT,
]);

const KNOWN_SYSTEM_PROMPTS = new Set([...LEGACY_SYSTEM_PROMPTS, ...OFFICIAL_SYSTEM_PROMPTS]);

const DEFAULT: DuplexSettings = {
  audioSource: 'mic',
  voice: VOICES[0].value,
  scene: 'audio_chinese_call',
  language: 'zh',
  languageMode: 'auto',
  system: OFFICIAL_AUDIO_DUPLEX_PROMPT,
  outputAudio: true,
  lengthPenalty: 1.05,
  maxTokens: 1024,
  maxKvTokens: 8192,
  temperature: 0.7,
  ttsEnabled: true,
  visionHD: false,
  /** 下行播放预留缓冲(ms)：0 等于零缓冲，网络抖一下就是可听见的断裂，默认留一点余量 */
  playbackDelay: 200,
  responseLengthPreset: 'balanced',
  subtitleHeightPercent: 20,
  subtitleBottomOpacity: 80,
  subtitleTopOpacity: 30,
  micDeviceId: '',
  speakerDeviceId: '',
};

function createDefaultSettings(language: DuplexLanguage): DuplexSettings {
  const official = promptForAudioSource('mic', language);
  return {
    ...DEFAULT,
    ...official,
    languageMode: 'auto',
  };
}

/**
 * 将用户选择的音色转换为实际发送给模型的声音要求。
 *
 * @param system 用户在面板中编辑的系统提示词
 * @param voice 音色标识
 * @returns 保留原提示词并追加声音要求的有效系统提示词
 */
export function buildDuplexSystemPrompt(
  system: string,
  voice: string,
  language: DuplexLanguage = 'zh',
): string {
  const option = VOICES.find((item) => item.value === voice);
  const base = system.trim();
  if (!option?.instruction) return base;
  const instruction = language === 'en' ? option.instructionEn : option.instruction;
  const prefix = language === 'en' ? 'Voice requirements:' : '声音要求：';
  return `${base}\n\n${prefix} ${instruction}`;
}

/**
 * 从持久化数据恢复双工设置，并迁移旧的官方场景提示词。
 *
 * @param saved localStorage 中读取的部分设置
 * @returns 带默认值和迁移结果的完整双工设置
 */
export function resolveInitialDuplexSettings(
  saved: Partial<DuplexSettings>,
  locale: AppLocale = 'zh-CN',
): DuplexSettings {
  const source = saved.audioSource === 'both' ? 'both' : 'mic';
  const savedScene = SCENES.find((scene) => scene.value === saved.scene);
  const hasSavedSettings = Object.keys(saved).length > 0;
  const legacyDefault =
    !hasSavedSettings ||
    (saved.languageMode === undefined &&
      saved.scene === 'audio_chinese_call' &&
      saved.system === OFFICIAL_AUDIO_DUPLEX_PROMPT);
  const languageMode: DuplexLanguageMode =
    saved.languageMode ?? (legacyDefault ? 'auto' : 'manual');
  let language = languageForLocale(locale);
  if (languageMode === 'manual') {
    language = saved.language === 'en' || savedScene?.language === 'en' ? 'en' : 'zh';
  }
  const official = promptForAudioSource(source, language);
  const shouldMigrate =
    !saved.system ||
    LEGACY_SYSTEM_PROMPTS.has(saved.system) ||
    languageMode === 'auto' ||
    (KNOWN_SYSTEM_PROMPTS.has(saved.system) &&
      (savedScene?.language !== language || saved.scene !== official.scene));
  // 双工只支持官方预置音色；历史持久化的私有音色 ID 必须回退，避免继续发送旧选择。
  const voice = VOICES.find((item) => item.value === saved.voice)?.value ?? DEFAULT.voice;

  return {
    ...DEFAULT,
    ...saved,
    voice,
    audioSource: source,
    language,
    languageMode,
    ...(shouldMigrate ? official : {}),
  };
}

/**
 * 双工参数状态。
 */
export function useDuplexSettings() {
  const storeLocale = useAppStore((state) => state.locale);
  const { i18n } = useTranslation();
  // i18next 语言切换先于持久化 store hydration 完成，优先使用已生效的界面语言，
  // 避免英文界面首次打开时短暂或持续回显中文场景提示词。
  const locale: AppLocale =
    i18n.resolvedLanguage === 'en-US' || storeLocale === 'en-US' ? 'en-US' : 'zh-CN';
  const previousLocale = useRef(locale);
  const [settings, setSettings] = useState<DuplexSettings>(() => {
    try {
      const saved = JSON.parse(
        window.localStorage.getItem('map-duplex-settings') || '{}',
      ) as Partial<DuplexSettings>;
      return resolveInitialDuplexSettings(saved, locale);
    } catch {
      return createDefaultSettings(languageForLocale(locale));
    }
  });

  useEffect(() => {
    if (previousLocale.current === locale) return;
    previousLocale.current = locale;
    setSettings((prev) => {
      if (prev.languageMode !== 'auto') return prev;
      const official = promptForAudioSource(prev.audioSource, languageForLocale(locale));
      const next = { ...prev, ...official, languageMode: 'auto' as const };
      try {
        window.localStorage.setItem('map-duplex-settings', JSON.stringify(next));
      } catch {
        /* best effort */
      }
      return next;
    });
  }, [locale]);

  const patch = useCallback((p: Partial<DuplexSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...p };
      try {
        window.localStorage.setItem('map-duplex-settings', JSON.stringify(next));
      } catch {
        /* best effort */
      }
      return next;
    });
  }, []);

  const selectLanguage = useCallback((language: DuplexLanguage) => {
    setSettings((prev) => {
      const official = promptForAudioSource(prev.audioSource, language);
      const next = { ...prev, ...official, languageMode: 'manual' as const };
      try {
        window.localStorage.setItem('map-duplex-settings', JSON.stringify(next));
      } catch {
        /* best effort */
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    try {
      window.localStorage.removeItem('map-duplex-settings');
    } catch {
      /* best effort */
    }
    setSettings(createDefaultSettings(languageForLocale(locale)));
  }, [locale]);

  return { settings, patch, selectLanguage, reset };
}
