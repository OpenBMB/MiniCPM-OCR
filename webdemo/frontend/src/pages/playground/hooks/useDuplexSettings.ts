/**
 * Realtime audio and video (duplex) parameter-state hook.
 *
 * Purpose: manage every adjustable parameter of a duplex call in one place (aligned with the MiniCPM-o demo) — conversation mode, voice,
 * system prompt, TTS switch, Length Penalty, Max Tokens, Temperature, playback delay, microphone/speaker,
 * and reference audio (voice clone). Collapsed to one object plus patch, for page orchestration and request assembly.
 */

import { useAppStore, type AppLocale } from '@map/store';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Generic option */
export interface DuplexOption {
  value: string;
  label: string;
}

/** Duplex voice option, including the voice requirement and optional reference-audio asset. */
export interface DuplexVoiceOption extends DuplexOption {
  instruction: string;
  instructionEn: string;
  refPath?: string;
}

export type DuplexLanguage = 'zh' | 'en';

/** Duplex language source: follow the UI language, or be set manually by the user in the duplex panel. */
export type DuplexLanguageMode = 'auto' | 'manual';

/** UI and prompt languages the official demo supports. */
export const LANGUAGES: DuplexOption[] = [
  { value: 'zh', label: 'languageChinese' },
  { value: 'en', label: 'languageEnglish' },
];

/** Conversation mode (the field name audioSource is kept for compatibility with existing persisted config) */
export const SOURCES: DuplexOption[] = [
  { value: 'mic', label: 'audioDuplex' },
  { value: 'both', label: 'videoDuplex' },
];

/** Conversation voice */
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

/** Original text of the official MiniCPM-o-Demo presets. */
export const OFFICIAL_AUDIO_DUPLEX_PROMPT =
  '扮演一个具有以上声音特征的助手。请认真、高质量地回复用户的问题。请用高自然度的方式和用户聊天。你处于双工模式，可以一边听、一边说。你是由面壁智能开发的人工智能助手：面壁小钢炮。';
export const OFFICIAL_AUDIO_DUPLEX_ENGLISH_PROMPT =
  "Act as an assistant with the voice characteristics described above. Respond to the user's questions thoughtfully and with high quality. Chat with the user in a highly natural manner. You are in duplex mode, so you can listen and speak at the same time. You are ModelBest Xiao Gang Pao, an AI assistant developed by ModelBest Intelligence.";
export const OFFICIAL_OMNI_PROMPT = 'Streaming Omni Conversation.';

/** Scene preset → system prompt; the content corresponds to MiniCPM-o-Demo/assets/presets. */
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

/** Every duplex parameter */
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
  /** Reference audio (voice clone) raw base64 */
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
  /** Reserved downlink playback buffer (ms): 0 means zero buffer, and one network jitter is an audible break, so a little margin is left by default */
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
 * Turn the voice the user selected into the voice requirement actually sent to the model.
 *
 * @param system system prompt the user edited in the panel
 * @param voice voice id
 * @returns an effective system prompt that keeps the original prompt and appends the voice requirement
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
 * Restore duplex settings from persisted data, and migrate old official scene prompts.
 *
 * @param saved partial settings read from localStorage
 * @returns complete duplex settings with defaults and the migration result
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
  // Duplex supports only official preset voices; a historically persisted private voice ID must fall back, so the old selection is not sent again.
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
 * Duplex parameter state.
 */
export function useDuplexSettings() {
  const storeLocale = useAppStore((state) => state.locale);
  const { i18n } = useTranslation();
  // An i18next language change finishes before the persisted store hydrates, so prefer the UI language that is already in effect,
  // and avoid briefly or persistently echoing Chinese scene prompts the first time the English UI opens.
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
