/**
 * 单轮生成性能指标的派生与格式化纯函数。
 *
 * 用途：把 useChat 埋点得到的原始计时（firstTokenMs/durationMs）与尾块 usage，
 * 换算为消息底部指标行所需的展示值（秒、tokens/s），无副作用便于单测与复用。
 */

import type { MessageMetrics } from '../types';
import type { TokenUsage } from '@/api/map/chat';

/** 单个指标项的展示结构 */
export interface MetricItem {
  /** 指标名（如「首 token」） */
  label: string;
  /** 主数值文本（如「0.32」「51」） */
  value: string;
  /** 数值单位（如「s」「tokens/s」；无单位时为空串） */
  unit: string;
  /** 悬浮说明；无则不展示 info 图标 */
  hint?: string;
}

/** 毫秒转秒并保留两位小数（如 320 → "0.32"） */
export function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(2);
}

/**
 * 输出速率（tokens/s）：完成 token 数 ÷ 纯生成耗时。
 * 纯生成耗时 = 总耗时 − 首 token 延迟（扣除排队/首包网络往返，更贴近吐字速度）。
 * 缺少任一输入、或有效耗时 ≤ 0 时返回 null（不展示）。
 *
 * @param completionTokens 本轮完成（输出）token 数
 * @param firstTokenMs 首 token 延迟（ms）
 * @param durationMs 总耗时（ms）
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
 * 组装消息底部要展示的指标项列表（按参考看板口径：首 token / 总耗时 / 输出速率 / 共调用）。
 * 仅纳入有数据的项；全无则返回空数组，交由调用方决定是否渲染。
 *
 * @param metrics 前端计时指标（可能只有部分字段）
 * @param usage 尾块 token 用量
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
