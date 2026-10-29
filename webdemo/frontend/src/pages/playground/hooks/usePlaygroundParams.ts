/**
 * Conversation parameter-preference hook (persisted per model).
 *
 * Purpose: own parameters such as temperature, top_p, maximum output, reasoning depth, reasoning style, and streaming. These parameters are **remembered per model** —
 * a user setting takes priority over the model parameter_config; a numeric field set by neither stays empty.
 */

import { useCallback, useMemo } from 'react';
import { useAppStore } from '@map/store';
import { allowsReasoning, PLAYGROUND_TOGGLE_KEYS } from '../../models/components/modelCapabilities';
import { DEFAULT_PARAMS, type PlaygroundParams, type ThinkingDepth } from '../types';
import { requiresNonStreaming } from '../utils/params';
import { resolveModelParameterDefaults } from '../utils/modelParameterDefaults';

/** usePlaygroundParams return value */
interface UsePlaygroundParamsReturn {
  params: PlaygroundParams;
  /** Update parameters incrementally (written into the copy for the current model) */
  update: (patch: Partial<PlaygroundParams>) => void;
  /** Set reasoning depth on its own */
  setThinkingDepth: (depth: ThinkingDepth) => void;
  /** Toggle web search */
  setWebSearch: (webSearch: boolean) => void;
  /** Set the tool list enabled for web search (takes effect when webSearch=true) */
  setEnabledTools: (tools: string[]) => void;
  /** Set the user location (used by the datetime tool) */
  setUserLocation: (location: string) => void;
  /** Toggle streaming output */
  setStream: (stream: boolean) => void;
  /** Reset the current model to defaults */
  reset: () => void;
}

/**
 * Parameter-preference state machine (per model).
 * @param modelId currently selected model id; when empty, fall back to one temporary set of default parameters (still adjustable, but not stored on a specific model)
 * @param capabilities deep_thinking decides the capability, and show_reasoning only decides the default when the user has not set a preference.
 *   When unsupported, override the archive and model parameters and force it off; when supported, keep the choice the user saved per model.
 * @param parameterConfig model-level default request parameters configured in the admin console.
 * @param allowWebSearch whether the current model explicitly supports web search; treated as unsupported when omitted.
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

  // raw is the parameters currently in effect, but model defaults are not written into user preferences, so a later admin-console change does not stop taking effect.
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
      // When the client switch matches the model default, L2 still injects it as-is; when they differ, explicitly override the whole reasoning-parameter group.
      includeThinkingParams:
        storedHasThinkingOverride ||
        !modelDefaults.hasThinkingDefaults ||
        thinkingDepth !== modelDefaults.values.thinkingDepth,
      thinkingControlFormat:
        stored?.thinkingStyle === 'thinking' ? 'thinking' : modelDefaults.thinkingControlFormat,
      thinkingDefaults: modelDefaults.values.thinkingDefaults,
      // MiniCPM-OCR-Jev defaults to non-streaming; the user turning it on explicitly keeps only the UI preference, and the actual request is forced non-streaming by the completion path.
      stream:
        stored?.stream ??
        (forceNonStreaming ? false : (modelDefaults.values.stream ?? DEFAULT_PARAMS.stream)),
      webSearch: allowWebSearch ? (stored?.webSearch ?? DEFAULT_PARAMS.webSearch) : false,
      // Do not fall back to a default: when no tool selection has been stored, keep it undefined, so enabled_tools does not appear in the request body,
      // and the backend enables every tool from that (see the three-state note on enabledTools in types.ts).
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

  // When deep reasoning is unsupported it must be turned off explicitly, so an old preference or an L2 default parameter does not turn it back on.
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
