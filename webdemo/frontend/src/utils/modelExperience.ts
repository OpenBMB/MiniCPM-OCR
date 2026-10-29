/**
 * 体验中心的模型分类工具。
 *
 * 用途：后端返回同一份「全量可调用模型」，前端按管理端配置的能力位筛选四类体验：
 * - tts：勾了「语音合成」，走 /v1/audio/speech
 * - realtime：勾了「实时对话」，走 /v1/realtime
 * - image-parse：勾了「图像解析」且支持图像输入，走 Chat Completions 做图像 → Markdown
 * - language：普通对话模型，以及同时支持文本输入的图像解析模型
 * 支持文本输入的图像解析模型可同时出现在语言对话与图像解析列表中。
 *
 * 判定**只认 capabilities**（管理端显式勾选、migration 0032 已归一存量数据），不再按模型名
 * 关键词猜测——改个模型名就分错、新接入模型必须改代码，都是关键词方案的老毛病。
 * 模型没进对体验，就去管理台把能力位勾上。
 */

import type { MapModel } from '@/api/map';

/** 模型在体验中心的类别 */
export type ModelExperience = 'language' | 'tts' | 'realtime' | 'image-parse';

/**
 * 体验中心分流所依据的能力 key（管理端「能力支持」里勾选，与后端门禁同名）。
 * - speech_synthesis：语音合成（历史数据里叫 audio_speech，见 migration 0032）
 * - realtime_dialog：实时对话
 * - document_parse：图像 → Markdown 解析；必须同时具备 input_image，避免纯文本模型误入
 */
export const EXPERIENCE_CAPABILITY_KEYS = {
  speechSynthesis: 'speech_synthesis',
  realtimeDialog: 'realtime_dialog',
  documentParse: 'document_parse',
} as const;

/**
 * 判断模型是否启用指定协议。
 *
 * `protocols` 为空数组时明确表示未定义协议；字段缺失时兼容旧后端，按历史默认协议处理。
 * @param model 单个可调用模型
 * @param protocol 目标协议
 * @returns 是否支持该协议
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
 * speech_synthesis 归一前的历史 key。migration 0032 会把它改写掉，
 * 但迁移与前端发版存在时间差，兼容期一并认，避免语音合成体验短时空列表。
 */
const LEGACY_SPEECH_KEY = 'audio_speech';

/**
 * 判定单个模型的主要体验类别，供接入示例选择协议。
 * 同时具备时：实时优先于语音合成；图像解析模型仍可按文本能力进入语言对话列表。
 * @param model 单个可调用模型
 * @returns 该模型所属体验类别
 */
export function classifyModel(model: MapModel): ModelExperience {
  const caps = model.capabilities;
  if (caps?.[EXPERIENCE_CAPABILITY_KEYS.realtimeDialog]) return 'realtime';
  if (caps?.[EXPERIENCE_CAPABILITY_KEYS.speechSynthesis] || caps?.[LEGACY_SPEECH_KEY]) return 'tts';
  if (caps?.[EXPERIENCE_CAPABILITY_KEYS.documentParse] && caps?.input_image) return 'image-parse';
  return 'language';
}

/**
 * 取某一体验类别下的全部可选模型（保持后端返回顺序）。
 * @param models 全量可调用模型
 * @param experience 目标体验类别
 * @returns 该类别下的模型列表，可能为空
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
 * 语言对话可选模型（排除语音合成、实时对话及未声明文本输入的图像解析模型）。
 * @param models 全量可调用模型
 * @returns 仅语言对话模型
 */
export function languageModels(models: MapModel[]): MapModel[] {
  return modelsByExperience(models, 'language');
}

/**
 * 判定模型是否正处于免费调用期（后端按定价时间窗实时计算）。
 * 免费模型对所有用户免费调用，体验中心据此展示「免费」标签。
 * @param model 单个可调用模型
 * @returns 是否限时免费
 */
export function isFreeModel(model: MapModel): boolean {
  return Boolean(model.is_free);
}
