import { describe, expect, it } from 'vitest';
import { formatDate, formatNumber } from './format';

describe('i18n format helpers', () => {
  it('should format dates using the selected locale', () => {
    const value = new Date(Date.UTC(2026, 7, 15));

    expect(formatDate(value, 'zh-CN')).toBe('2026年8月15日');
    expect(formatDate(value, 'en-US')).toBe('Aug 15, 2026');
  });

  it('should format numbers using the selected locale', () => {
    expect(formatNumber(12345.6, 'zh-CN')).toBe('12,345.6');
    expect(formatNumber(12345.6, 'en-US')).toBe('12,345.6');
  });
});
