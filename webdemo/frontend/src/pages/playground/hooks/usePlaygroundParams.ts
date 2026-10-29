/**
 * 对话参数偏好 hook（按模型持久化）。
 *
 * 用途：托管温度/top_p/最大输出/思考深度/思考风格/流式等参数。这些参数**按模型分别记忆**——
 * 用户设置优先于模型 parameter_config；两者都未设置的数值字段保持空值。
 */

import { useCallback, useMemo } from 'react';
import { useAppStore } from '@map/store';
import { allowsReasoning, PLAYGROUND_TOGGLE_KEYS } from '../../models/components/modelCapabilities';
import { DEFAULT_PARAMS, type PlaygroundParams, type ThinkingDepth } from '../types';
import { requiresNonStreaming } from '../utils/params';
import { resolveModelParameterDefaults } from '../utils/modelParameterDefaults';

/** usePlaygroundParams 返回 */
interface UsePlaygroundParamsReturn {
  params: PlaygroundParams;
  /** 增量更新参数（写入当前模型那份） */
  update: (patch: Partial<PlaygroundParams>) => void;
  /** 单独设置思考深度 */
  setThinkingDepth: (depth: ThinkingDepth) => void;
  /** 切换联网搜索 */
  setWebSearch: (webSearch: boolean) => void;
  /** 设置联网启用的工具列表（webSearch=true 时生效） */
  setEnabledTools: (tools: string[]) => void;
  /** 设置用户位置（用于 datetime 工具） */
  setUserLocation: (location: string) => void;
  /** 切换流式输出 */
  setStream: (stream: boolean) => void;
  /** 重置当前模型为默认值 */
  reset: () => void;
}

/**
 * 参数偏好状态机（按模型）。
 * @param modelId 当前选中模型 id；为空时退化为一份临时默认参数（仍可调，但不落到具体模型）
 * @param capabilities deep_thinking 决定能力，show_reasoning 仅决定未设置用户偏好时的默认值。
 *   不支持时覆盖存档与模型参数，强制关闭；支持时保留用户按模型保存的选择。
 * @param parameterConfig 管理端配置的模型级默认请求参数。
 * @param allowWebSearch 当前模型是否显式支持联网搜索；缺省按不支持处理。
 */
export function usePlaygroundParams(
  modelId: string,
  capabilities?: Record<string, boolean>,
  parameterConfig?: Record<string, unknown>,
  allowWebSearch = false,
): UsePlaygroundParamsReturn {
  const stored = useAppStore((s) => s.playground.paramsByModel[modelId]);
  const setModelParams = useAppStore((s) => s.setModelParams);
  const clearModelParams = useAppStore((s) => s.clearModelParams);
  const allowReasoning = allowsReasoning(capabilities);
  const forceNonStreaming = requiresNonStreaming(modelId);
  const defaultThinkingDepth: ThinkingDepth =
    capabilities?.[PLAYGROUND_TOGGLE_KEYS.showReasoning] === false ? 'off' : 'on';
  const modelDefaults = useMemo(
    () => resolveModelParameterDefaults(parameterConfig),
    [parameterConfig],
  );
  const storedHasThinkingOverride =
    stored?.thinkingDepth !== undefined || stored?.thinkingStyle !== undefined;
  const thinkingDepth =
    stored?.thinkingDepth ?? modelDefaults.values.thinkingDepth ?? defaultThinkingDepth;

  // raw 是当前生效参数，但模型默认值不会写入用户偏好，避免后续管理端调整失效。
  const raw = useMemo<PlaygroundParams>(() => {
    return {
      ...DEFAULT_PARAMS,
      ...modelDefaults.values,
      ...stored,
      temperature: stored?.temperature ?? modelDefaults.values.temperature,
      topP: stored?.topP ?? modelDefaults.values.topP,
      maxTokens: stored?.maxTokens ?? modelDefaults.values.maxTokens,
      thinkingDepth,
      thinkingStyle:
        stored?.thinkingStyle ?? modelDefaults.values.thinkingStyle ?? DEFAULT_PARAMS.thinkingStyle,
      // 客户端开关与模型默认一致时仍由 L2 原样注入；不一致时显式覆盖整组思考参数。
      includeThinkingParams:
        storedHasThinkingOverride ||
        !modelDefaults.hasThinkingDefaults ||
        thinkingDepth !== modelDefaults.values.thinkingDepth,
      thinkingControlFormat:
        stored?.thinkingStyle === 'thinking' ? 'thinking' : modelDefaults.thinkingControlFormat,
      thinkingDefaults: modelDefaults.values.thinkingDefaults,
      // MiniCPM-OCR-Jev 默认非流式；用户显式打开只保留 UI 偏好，实际请求由补全链路强制非流式。
      stream:
        stored?.stream ??
        (forceNonStreaming ? false : (modelDefaults.values.stream ?? DEFAULT_PARAMS.stream)),
      webSearch: allowWebSearch ? (stored?.webSearch ?? DEFAULT_PARAMS.webSearch) : false,
      // 不回落到默认值：未存过工具选择时保持 undefined，请求体里不出现 enabled_tools，
      // 后端据此启用全部工具（见 types.ts 中 enabledTools 的三态说明）。
      enabledTools: stored?.enabledTools,
      userLocation: stored?.userLocation,
    };
  }, [
    stored,
    modelDefaults,
    storedHasThinkingOverride,
    thinkingDepth,
    allowWebSearch,
    forceNonStreaming,
  ]);

  // 不支持深度思考时必须显式关闭，避免旧偏好或 L2 默认参数重新开启。
  const params = useMemo<PlaygroundParams>(
    () =>
      allowReasoning
        ? raw
        : {
            ...raw,
            thinkingDepth: 'off',
            thinkingStyle: modelDefaults.values.thinkingStyle ?? DEFAULT_PARAMS.thinkingStyle,
            thinkingControlFormat: modelDefaults.thinkingControlFormat,
            includeThinkingParams: true,
          },
    [raw, allowReasoning, modelDefaults],
  );

  const update = useCallback(
    (patch: Partial<PlaygroundParams>) => {
      if (!modelId) return;
      setModelParams(modelId, patch);
    },
    [modelId, setModelParams],
  );

  const setThinkingDepth = useCallback(
    (depth: ThinkingDepth) => {
      if (allowReasoning) update({ thinkingDepth: depth });
    },
    [update, allowReasoning],
  );

  const setWebSearch = useCallback(
    (webSearch: boolean) => {
      const nextWebSearch = allowWebSearch && webSearch;
      update(nextWebSearch ? { webSearch: true, stream: true } : { webSearch: false });
    },
    [update, allowWebSearch],
  );

  const setEnabledTools = useCallback(
    (enabledTools: string[]) => update({ enabledTools }),
    [update],
  );

  const setUserLocation = useCallback((userLocation: string) => update({ userLocation }), [update]);

  const setStream = useCallback((stream: boolean) => update({ stream }), [update]);

  const reset = useCallback(() => {
    if (!modelId) return;
    clearModelParams(modelId);
  }, [modelId, clearModelParams]);

  return {
    params,
    update,
    setThinkingDepth,
    setWebSearch,
    setEnabledTools,
    setUserLocation,
    setStream,
    reset,
  };
}
