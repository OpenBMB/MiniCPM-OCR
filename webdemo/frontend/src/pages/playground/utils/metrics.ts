/**
 * Pure functions that derive and format performance metrics for one generation.
 *
 * Purpose: turn raw timings from useChat instrumentation (firstTokenMs/durationMs) and the tail usage
 * into the display values the message-footer metrics row needs (seconds, tokens/s). No side effects, so they are easy to unit test and reuse.
 */

import type { MessageMetrics } from '../types';
import type { TokenUsage } from '@/api/map/chat';

/** Display structure of one metric item */
export interface MetricItem {
  /** Metric name (such as "time to first token") */
  label: string;
  /** Primary value text (such as "0.32" or "51") */
  value: string;
  /** Value unit (such as "s" or "tokens/s"; an empty string when there is no unit) */
  unit: string;
  /** Hover explanation; when absent, do not show the info icon */
  hint?: string;
}

/** Convert milliseconds to seconds with two decimal places (for example 320 → "0.32") */
export function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(2);
}

/**
 * Output rate (tokens/s): completion token count ÷ pure generation time.
 * Pure generation time = total elapsed − time to first token (queueing and the first-packet round trip are excluded, so it is closer to the token rate).
 * Return null (do not display) when any input is missing, or the effective elapsed time is ≤ 0.
 *
 * @param completionTokens completion (output) token count for this turn
 * @param firstTokenMs time to first token (ms)
 * @param durationMs total elapsed time (ms)
 */
export function outputRate(
  completionTokens: number | undefined,
  firstTokenMs: number | undefined,
  durationMs: number | undefined,
): number | null {
  if (!completionTokens || durationMs === undefined) return null;
  const genMs = durationMs - (firstTokenMs ?? 0);
  if (genMs <= 0) return null;
  return completionTokens / (genMs / 1000);
}

/**
 * Assemble the metric items to show in the message footer (dashboard convention: time to first token / total elapsed / output rate / total calls).
 * Include only items that have data; if none do, return an empty array and let the caller decide whether to render.
 *
 * @param metrics frontend timing metrics (only some fields may be present)
 * @param usage tail-chunk token usage
 */
export function buildMetricItems(
  metrics: MessageMetrics | undefined,
  usage: TokenUsage | undefined,
): MetricItem[] {
  const items: MetricItem[] = [];

  if (metrics?.firstTokenMs !== undefined) {
    items.push({
      label: '首 token',
      value: formatSeconds(metrics.firstTokenMs),
      unit: 's',
      hint: '从发起请求到收到第一个输出片段的延迟',
    });
  }

  if (metrics?.durationMs !== undefined) {
    items.push({ label: '总耗时', value: formatSeconds(metrics.durationMs), unit: 's' });
  }

  const rate = outputRate(usage?.completion_tokens, metrics?.firstTokenMs, metrics?.durationMs);
  if (rate !== null) {
    items.push({ label: '输出', value: String(Math.round(rate)), unit: 'tokens/s' });
  }

  if (usage) {
    items.push({
      label: '共调用',
      value: usage.total_tokens.toLocaleString(),
      unit: 'tokens',
      hint: `输入 ${usage.prompt_tokens} · 输出 ${usage.completion_tokens}`,
    });
  }

  return items;
}
