/**
 * Unit tests for metrics derived pure functions: rate excludes time-to-first-token, and metric items are included only when data exists.
 */

import { describe, it, expect } from 'vitest';
import type { TokenUsage } from '@/api/map/chat';
import { buildMetricItems, formatSeconds, outputRate } from '../metrics';

describe('formatSeconds', () => {
  it('毫秒转秒保留两位小数', () => {
    expect(formatSeconds(320)).toBe('0.32');
    expect(formatSeconds(570)).toBe('0.57');
    expect(formatSeconds(0)).toBe('0.00');
  });
});

describe('outputRate', () => {
  it('速率 = 完成 token ÷（总耗时 − 首 token 延迟）', () => {
    // 51 tokens / (0.57s - 0.32s = 0.25s) = 204/s
    expect(outputRate(51, 320, 570)).toBeCloseTo(204, 0);
  });

  it('缺少完成 token 或总耗时时返回 null', () => {
    expect(outputRate(undefined, 320, 570)).toBeNull();
    expect(outputRate(51, 320, undefined)).toBeNull();
  });

  it('有效生成耗时 ≤ 0 时返回 null（避免除零/负值）', () => {
    expect(outputRate(51, 600, 500)).toBeNull();
    expect(outputRate(51, 570, 570)).toBeNull();
  });

  it('缺首 token 延迟时以总耗时作分母', () => {
    expect(outputRate(50, undefined, 1000)).toBeCloseTo(50, 5);
  });
});

describe('buildMetricItems', () => {
  const usage: TokenUsage = { prompt_tokens: 27, completion_tokens: 51, total_tokens: 118 };

  it('计时与用量齐全：四项俱全，顺序为首 token/总耗时/输出/共调用', () => {
    const items = buildMetricItems({ firstTokenMs: 320, durationMs: 570 }, usage);
    expect(items.map((i) => i.label)).toEqual(['首 token', '总耗时', '输出', '共调用']);
    expect(items[0]).toMatchObject({ value: '0.32', unit: 's' });
    expect(items[3]).toMatchObject({ value: '118', unit: 'tokens' });
  });

  it('无 usage 时不产出输出速率与共调用项', () => {
    const items = buildMetricItems({ firstTokenMs: 320, durationMs: 570 }, undefined);
    expect(items.map((i) => i.label)).toEqual(['首 token', '总耗时']);
  });

  it('全空返回空数组', () => {
    expect(buildMetricItems(undefined, undefined)).toEqual([]);
  });
});
