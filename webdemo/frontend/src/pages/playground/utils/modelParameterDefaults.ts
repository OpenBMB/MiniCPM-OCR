import { DEFAULT_PARAMS, type PlaygroundParams, type ThinkingDepth } from '../types';

interface ResolvedModelParameterDefaults {
  values: Partial<PlaygroundParams>;
  hasThinkingDefaults: boolean;
  thinkingControlFormat: PlaygroundParams['thinkingControlFormat'];
}

/**
 * 解析模型默认参数，用于数值回显与思考请求协议选择。
 * @param parameterConfig 管理端模型级默认请求参数
 * @returns 面板可表达的默认值、思考字段存在性与开关协议
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
      // 面板只对应 max_tokens；max_completion_tokens 留给 L2 按原字段名注入。
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

/** 仅接受面板可表达范围内的有限数字，避免异常配置污染受控输入。 */
function readNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (value < min || value > max) return undefined;
  return value;
}

/** 仅接受显式布尔值，其他类型继续使用体验中心默认行为。 */
function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/** 读取 chat_template_kwargs.enable_thinking。 */
function readEnableThinking(value: unknown): boolean | undefined {
  if (!isRecord(value)) return undefined;
  return readBoolean(value.enable_thinking);
}

/** 读取 thinking.type 的 enabled/disabled 状态。 */
function readThinkingEnabled(value: unknown): boolean | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === 'enabled') return true;
  if (value.type === 'disabled') return false;
  return undefined;
}

/** 把模型思考配置映射为开关值，仅用于判断是否需要覆盖 L2 默认参数。 */
function resolveThinkingDepth(
  enableThinking: boolean | undefined,
  thinkingEnabled: boolean | undefined,
  hasReasoningEffort: boolean,
): ThinkingDepth | undefined {
  // 矛盾的双协议默认值不能判为匹配，必须让客户端显式统一两种开关。
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

/** 根据模型配置中存在的思考字段选择对应的面板参数风格。 */
function resolveThinkingStyle(
  hasThinkingSwitch: boolean,
  hasReasoningEffort: boolean,
): PlaygroundParams['thinkingStyle'] | undefined {
  if (hasThinkingSwitch && hasReasoningEffort) return 'both';
  if (hasThinkingSwitch) return 'thinking';
  if (hasReasoningEffort) return 'reasoning_effort';
  return undefined;
}

/** 保留模型默认配置实际使用的思考开关协议。 */
function resolveThinkingControlFormat(
  hasChatTemplateKwargs: boolean,
  hasThinking: boolean,
): PlaygroundParams['thinkingControlFormat'] {
  if (hasChatTemplateKwargs && hasThinking) return 'both';
  if (hasThinking) return 'thinking';
  return 'chat_template_kwargs';
}

/** 判断未知值是否为可读取字段的普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 兼容当前编译目标的自有字段判断。 */
function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}
