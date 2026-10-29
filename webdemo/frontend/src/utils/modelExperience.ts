/**
 * Model classification helpers for the Playground.
 *
 * Purpose: the backend returns one list of "all callable models", and the frontend filters four experiences from capability flags configured in admin:
 * - tts: "speech synthesis" is checked, and it uses /v1/audio/speech
 * - realtime: "realtime conversation" is checked, and it uses /v1/realtime
 * - image-parse: "image parse" is checked and image input is supported; Chat Completions turns an image into Markdown
 * - language: ordinary chat models, plus image-parse models that also accept text input
 * An image-parse model that accepts text can appear in both the language chat list and the image-parse list.
 *
 * The decision trusts capabilities only (explicitly checked in admin; migration 0032 already normalized existing data), and no longer guesses from model-name
 * keywords — a renamed model landing in the wrong place, and every new model requiring a code change, were the old problems with keywords.
 * If a model is in the wrong experience, check the capability flag in the admin console.
 */

import type { MapModel } from '@/api/map';

/** A model’s experience category in the Playground. */
export type ModelExperience = 'language' | 'tts' | 'realtime' | 'image-parse';

/**
 * Capability keys the Playground uses to route models (checked under admin "capability support", same names as the backend gate).
 * - speech_synthesis: speech synthesis (called audio_speech in historical data; see migration 0032)
 * - realtime_dialog: realtime conversation
 * - document_parse: image → Markdown parsing; input_image is also required so a text-only model is not admitted
 */
export const EXPERIENCE_CAPABILITY_KEYS = {
  speechSynthesis: 'speech_synthesis',
  realtimeDialog: 'realtime_dialog',
  documentParse: 'document_parse',
} as const;

/**
 * Whether a model has a given protocol enabled.
 *
 * An empty `protocols` array means no protocol is defined; when the field is missing, stay compatible with older backends and use the historical default protocol.
 * @param model One callable model.
 * @param protocol Target protocol.
 * @returns Whether that protocol is supported.
 */
export function modelSupportsProtocol(
  model: MapModel,
  protocol: 'openai' | 'anthropic' | 'document_parse',
): boolean {
  if (model.protocols) return model.protocols.includes(protocol);
  if (protocol === 'anthropic') return Boolean(model.supports_anthropic);
  return true;
}

/**
 * Historical key from before speech_synthesis was normalized. Migration 0032 rewrites it,
 * but migration and the frontend release can be apart in time, so the compatibility window accepts both and the speech-synthesis experience does not briefly show an empty list.
 */
const LEGACY_SPEECH_KEY = 'audio_speech';

/**
 * Decide one model’s primary experience category, so integration examples can pick a protocol.
 * When several apply: realtime wins over speech synthesis; an image-parse model can still enter the language chat list by its text capability.
 * @param model One callable model.
 * @returns The experience category that model belongs to.
 */
export function classifyModel(model: MapModel): ModelExperience {
  const caps = model.capabilities;
  if (caps?.[EXPERIENCE_CAPABILITY_KEYS.realtimeDialog]) return 'realtime';
  if (caps?.[EXPERIENCE_CAPABILITY_KEYS.speechSynthesis] || caps?.[LEGACY_SPEECH_KEY]) return 'tts';
  if (caps?.[EXPERIENCE_CAPABILITY_KEYS.documentParse] && caps?.input_image) return 'image-parse';
  return 'language';
}

/**
 * All selectable models in one experience category (keeps the backend order).
 * @param models All callable models.
 * @param experience Target experience category.
 * @returns Models in that category; may be empty.
 */
export function modelsByExperience(models: MapModel[], experience: ModelExperience): MapModel[] {
  return models.filter((m) => {
    const primaryExperience = classifyModel(m);
    if (experience === 'language') {
      if (primaryExperience !== 'language' && primaryExperience !== 'image-parse') return false;
      if (primaryExperience === 'image-parse' && m.capabilities?.input_text !== true) return false;
      return modelSupportsProtocol(m, 'openai');
    }
    if (experience === 'image-parse') {
      return primaryExperience === 'image-parse' && modelSupportsProtocol(m, 'document_parse');
    }
    return primaryExperience === experience;
  });
}

/**
 * Models selectable for language chat (excludes speech synthesis, realtime conversation, and image-parse models that do not declare text input).
 * @param models All callable models.
 * @returns Language-chat models only.
 */
export function languageModels(models: MapModel[]): MapModel[] {
  return modelsByExperience(models, 'language');
}

/**
 * Whether a model is currently in its free-call window (the backend computes this live from the pricing window).
 * A free model is free for every user, and the Playground shows a "Free" tag from this.
 * @param model One callable model.
 * @returns Whether it is free for a limited time.
 */
export function isFreeModel(model: MapModel): boolean {
  return Boolean(model.is_free);
}
