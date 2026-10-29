import { DEFAULT_PARAMS, type PlaygroundParams, type ThinkingDepth } from '../types';

interface ResolvedModelParameterDefaults {
  values: Partial<PlaygroundParams>;
  hasThinkingDefaults: boolean;
  thinkingControlFormat: PlaygroundParams['thinkingControlFormat'];
}

/**
 * Parse model default parameters, used for numeric echo and choosing the reasoning request protocol.
 * @param parameterConfig model-level default request parameters from the admin console
 * @returns defaults the panel can express, whether reasoning fields exist, and the switch protocol
 */
export function resolveModelParameterDefaults(
  parameterConfig?: Record<string, unknown>,
): ResolvedModelParameterDefaults {
  if (!parameterConfig) {
    return {
      values: {},
      hasThinkingDefaults: false,
      thinkingControlFormat: DEFAULT_PARAMS.thinkingControlFormat,
    };
  }
  const hasChatTemplateKwargs = hasOwn(parameterConfig, 'chat_template_kwargs');
  const hasReasoningEffort = hasOwn(parameterConfig, 'reasoning_effort');
  const hasThinking = hasOwn(parameterConfig, 'thinking');
  const enableThinking = readEnableThinking(parameterConfig.chat_template_kwargs);
  const thinkingEnabled = readThinkingEnabled(parameterConfig.thinking);
  return {
    values: {
      temperature: readNumber(parameterConfig.temperature, 0, 2),
      topP: readNumber(parameterConfig.top_p, 0, 1),
      // The panel corresponds only to max_tokens; max_completion_tokens is left for L2 to inject under the original field name.
      maxTokens: readNumber(parameterConfig.max_tokens, 0, 32768),
      thinkingDepth: resolveThinkingDepth(
        enableThinking,
        thinkingEnabled,
        hasReasoningEffort || hasThinking,
      ),
      thinkingStyle: resolveThinkingStyle(hasChatTemplateKwargs || hasThinking, hasReasoningEffort),
      thinkingDefaults: {
        chat_template_kwargs: isRecord(parameterConfig.chat_template_kwargs)
          ? parameterConfig.chat_template_kwargs
          : undefined,
        thinking: isRecord(parameterConfig.thinking) ? parameterConfig.thinking : undefined,
      },
      stream: readBoolean(parameterConfig.stream),
    },
    hasThinkingDefaults: hasChatTemplateKwargs || hasReasoningEffort || hasThinking,
    thinkingControlFormat: resolveThinkingControlFormat(hasChatTemplateKwargs, hasThinking),
  };
}

/** Accept only a finite number inside the range the panel can express, so a bad config does not pollute a controlled input. */
function readNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (value < min || value > max) return undefined;
  return value;
}

/** Accept only an explicit boolean; other types keep the experience-center default behavior. */
function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/** Read chat_template_kwargs.enable_thinking. */
function readEnableThinking(value: unknown): boolean | undefined {
  if (!isRecord(value)) return undefined;
  return readBoolean(value.enable_thinking);
}

/** Read the enabled/disabled state of thinking.type. */
function readThinkingEnabled(value: unknown): boolean | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === 'enabled') return true;
  if (value.type === 'disabled') return false;
  return undefined;
}

/** Map the model's reasoning config to a switch value, used only to decide whether L2 default parameters need to be overridden. */
function resolveThinkingDepth(
  enableThinking: boolean | undefined,
  thinkingEnabled: boolean | undefined,
  hasReasoningEffort: boolean,
): ThinkingDepth | undefined {
  // Contradictory defaults from the two protocols cannot be treated as a match; the client must explicitly unify both switches.
  if (
    enableThinking !== undefined &&
    thinkingEnabled !== undefined &&
    enableThinking !== thinkingEnabled
  ) {
    return undefined;
  }
  const enabled = enableThinking ?? thinkingEnabled;
  if (enabled !== undefined) return enabled ? 'on' : 'off';
  if (hasReasoningEffort) return 'on';
  return undefined;
}

/** Choose the matching panel parameter style from the reasoning fields present in the model config. */
function resolveThinkingStyle(
  hasThinkingSwitch: boolean,
  hasReasoningEffort: boolean,
): PlaygroundParams['thinkingStyle'] | undefined {
  if (hasThinkingSwitch && hasReasoningEffort) return 'both';
  if (hasThinkingSwitch) return 'thinking';
  if (hasReasoningEffort) return 'reasoning_effort';
  return undefined;
}

/** Keep the reasoning-switch protocol the model default config actually uses. */
function resolveThinkingControlFormat(
  hasChatTemplateKwargs: boolean,
  hasThinking: boolean,
): PlaygroundParams['thinkingControlFormat'] {
  if (hasChatTemplateKwargs && hasThinking) return 'both';
  if (hasThinking) return 'thinking';
  return 'chat_template_kwargs';
}

/** Whether an unknown value is an ordinary object whose fields can be read. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Own-property check compatible with the current compile target. */
function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}
