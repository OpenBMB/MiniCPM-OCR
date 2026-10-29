/**
 * 积分换算与展示格式化（money.ts）单测：
 *   - formatPoints：账本金额按 1:1 展示为固定两位积分 + 千分位；
 *   - formatPointsPerMillion：定价按 1:1 展示为固定两位小数积分/1M；
 *   - formatPointsQuota：可空额度 NullDecimal → 积分或「不限」。
 * 约束：1 元 = 1 积分，展示层不做换算。
 */

import { describe, it, expect } from 'vitest';
import {
  formatPoints,
  formatPointsPerMillion,
  formatPointsQuota,
} from '../money';

describe('formatPoints', () => {
  it('账本金额按 1:1 展示固定两位小数', () => {
    expect(formatPoints('12.34')).toBe('12.34');
    expect(formatPoints('100')).toBe('100.00');
  });

  it('小额消耗按两位小数展示', () => {
    expect(formatPoints('0.4')).toBe('0.40');
    expect(formatPoints('0.00001234')).toBe('0.00');
  });

  it('空/非法值返回 "0"', () => {
    expect(formatPoints(undefined)).toBe('0');
    expect(formatPoints('')).toBe('0');
    expect(formatPoints('abc')).toBe('0');
  });
});

describe('formatPointsPerMillion', () => {
  it('定价按积分展示为固定两位小数', () => {
    expect(formatPointsPerMillion('1')).toBe('1.00');
    expect(formatPointsPerMillion('3.456')).toBe('3.46');
  });

  it('零值、空值和非法值返回「-」', () => {
    expect(formatPointsPerMillion('0')).toBe('-');
    expect(formatPointsPerMillion(undefined)).toBe('-');
    expect(formatPointsPerMillion('x')).toBe('-');
  });
});

describe('formatPointsQuota', () => {
  it('未设置额度返回「不限」', () => {
    expect(formatPointsQuota(null)).toBe('不限');
    expect(formatPointsQuota({ Decimal: '50', Valid: false })).toBe('不限');
  });

  it('有效额度换算为积分', () => {
    expect(formatPointsQuota({ Decimal: '50', Valid: true })).toBe('50.00');
  });
});
