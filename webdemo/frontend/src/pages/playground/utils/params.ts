/**
 * Pure functions that map conversation parameters → request fields.
 *
 * Purpose: assemble this page's parameter preferences (temperature, reasoning depth, and so on) into backend `/v1/chat/completions` request parameters.
 * Reasoning fields are named differently per model; `thinkingStyle` decides whether to send reasoning_effort, thinking, or both.
 */

import type { PlaygroundParams, ThinkingControlFormat, ThinkingDepth } from '../types';
import type { ChatCompletionParams, ChatRequestMessage } from '@/api/map/chat';

/**
 * Whether the current public model belongs to the MiniCPM-V-4.7 series that already supports image-compression settings.
 * @param model public model ID
 * @returns true only for the exact series name or a hyphen suffix, so models such as v4.70 are not matched by mistake
 */
export function supportsImageDownsampleMode(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized === 'minicpm-v-4.7' || normalized.startsWith('minicpm-v-4.7-');
}

/**
 * Whether the current public model must use a non-streaming request.
 * @param model public model ID
 * @returns true only for MiniCPM-OCR-Jev, so other OCR models are not affected
 */
export function requiresNonStreaming(model: string): boolean {
  return model.trim().toLowerCase() === 'minicpm-ocr-jev';
}

/**
 * Build reasoning-related request fields from the reasoning-depth tier.
 *
 * Send `chat_template_kwargs.enable_thinking` or `thinking.type` according to the model protocol.
 * OpenAI-style `reasoning_effort` has no off value, and is attached by config style only when reasoning is on.
 *
 * @param depth reasoning-depth tier (on/off)
 * @param style reasoning parameter style
 * @param controlFormat protocol field the reasoning switch should use
 * @returns the reasoning-related fragment of request fields
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

  // OpenAI-style extra: the reasoning_effort enum has no "off" value, so medium is sent only when reasoning is on
  if (style === 'reasoning_effort' || style === 'both') {
    if (enabled) out.reasoning_effort = 'medium';
  }
  return out;
}

/**
 * Assemble the full conversation request parameters.
 *
 * @param model selected model id
 * @param messages history messages (already converted to role+content)
 * @param params parameter preferences
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
  // L2 overrides the reasoning object as a whole field; when the switch changes, same-level parameters from the model config must be kept.
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

/** A numeric parameter enters the request only when it is explicitly set and finite; 0 is not treated as empty. */
function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Image-processing parameters may be sent only when the current request actually contains image input. */
function hasImageInput(messages: ChatRequestMessage[]): boolean {
  return messages.some(
    (message) =>
      Array.isArray(message.content) && message.content.some((part) => part.type === 'image_url'),
  );
}
