/**
 * 对话参数 → 请求字段映射纯函数。
 *
 * 用途：把本页参数偏好（温度/思考深度等）组装为后端 `/v1/chat/completions` 请求参数。
 * 思考字段不同模型命名不一，按 `thinkingStyle` 决定发 reasoning_effort / thinking / 两者。
 */

import type { PlaygroundParams, ThinkingControlFormat, ThinkingDepth } from '../types';
import type { ChatCompletionParams, ChatRequestMessage } from '@/api/map/chat';

/**
 * 判断当前公开模型是否属于已支持图片压缩设置的 MiniCPM-V-4.7 系列。
 * @param model 公开模型 ID
 * @returns 仅精确系列名或连字符后缀返回 true，避免误匹配 v4.70 等模型
 */
export function supportsImageDownsampleMode(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized === 'minicpm-v-4.7' || normalized.startsWith('minicpm-v-4.7-');
}

/**
 * 判断当前公开模型是否必须使用非流式请求。
 * @param model 公开模型 ID
 * @returns 仅 MiniCPM-OCR-Jev 返回 true，避免影响其他 OCR 模型
 */
export function requiresNonStreaming(model: string): boolean {
  return model.trim().toLowerCase() === 'minicpm-ocr-jev';
}

/**
 * 由思考深度档位构造思考相关请求字段。
 *
 * 按模型协议发送 `chat_template_kwargs.enable_thinking` 或 `thinking.type`。
 * OpenAI 风格的 `reasoning_effort` 没有关闭值，仅在开启时按配置风格附加。
 *
 * @param depth 思考深度档位（on/off）
 * @param style 思考参数风格
 * @param controlFormat 思考开关应使用的协议字段
 * @returns 思考相关的请求字段片段
 */
export function buildThinkingParams(
  depth: ThinkingDepth,
  style: PlaygroundParams['thinkingStyle'],
  controlFormat: ThinkingControlFormat = style === 'thinking' ? 'thinking' : 'chat_template_kwargs',
): Partial<ChatCompletionParams> {
  const out: Partial<ChatCompletionParams> = {};
  const enabled = depth !== 'off';

  if (controlFormat === 'chat_template_kwargs' || controlFormat === 'both') {
    out.chat_template_kwargs = { enable_thinking: enabled };
  }
  if (controlFormat === 'thinking' || controlFormat === 'both') {
    out.thinking = { type: enabled ? 'enabled' : 'disabled' };
  }

  // OpenAI 风格附加项：reasoning_effort 枚举无「关闭」值，仅开启时下发 medium
  if (style === 'reasoning_effort' || style === 'both') {
    if (enabled) out.reasoning_effort = 'medium';
  }
  return out;
}

/**
 * 组装完整的对话请求参数。
 *
 * @param model 选中的模型 id
 * @param messages 历史消息（已转为 role+content）
 * @param params 参数偏好
 */
export function buildChatParams(
  model: string,
  messages: ChatRequestMessage[],
  params: PlaygroundParams,
): ChatCompletionParams {
  const base: ChatCompletionParams = {
    model,
    messages,
  };
  if (isFiniteNumber(params.temperature)) base.temperature = params.temperature;
  if (isFiniteNumber(params.topP)) base.top_p = params.topP;
  if (isFiniteNumber(params.maxTokens)) base.max_tokens = params.maxTokens;
  if (
    supportsImageDownsampleMode(model) &&
    hasImageInput(messages) &&
    (params.imageDownsampleMode === '4x' || params.imageDownsampleMode === '16x')
  ) {
    base.mm_processor_kwargs = { downsample_mode: params.imageDownsampleMode };
  }
  if (!params.includeThinkingParams) return base;
  const thinking = buildThinkingParams(
    params.thinkingDepth,
    params.thinkingStyle,
    params.thinkingControlFormat,
  );
  // L2 按整字段覆盖思考对象，修改开关时需保留模型配置的同层参数。
  if (thinking.chat_template_kwargs) {
    thinking.chat_template_kwargs = {
      ...params.thinkingDefaults?.chat_template_kwargs,
      ...thinking.chat_template_kwargs,
    };
  }
  if (thinking.thinking) {
    thinking.thinking = { ...params.thinkingDefaults?.thinking, ...thinking.thinking };
  }
  return {
    ...base,
    ...thinking,
  };
}

/** 数值参数只有在明确设置且为有限数字时才进入请求，0 不视为空值。 */
function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 仅当当前请求实际包含图片输入时，才允许发送图片处理参数。 */
function hasImageInput(messages: ChatRequestMessage[]): boolean {
  return messages.some(
    (message) =>
      Array.isArray(message.content) && message.content.some((part) => part.type === 'image_url'),
  );
}
