import { describe, expect, it } from 'vitest';
import { isValidPhone } from './validators';

describe('isValidPhone', () => {
  it('接受中国大陆 11 位手机号', () => {
    expect(isValidPhone('13800138000')).toBe(true);
  });

  it('接受带 +86 前缀的中国大陆手机号并按国内号码校验', () => {
    expect(isValidPhone('+8613800138000')).toBe(true);
  });

  it('拒绝非大陆号码和非法号段', () => {
    expect(isValidPhone('+14155550123')).toBe(false);
    expect(isValidPhone('12800138000')).toBe(false);
  });
});
