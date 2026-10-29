import { afterEach, describe, expect, it, vi } from 'vitest';

import { lazyWithRetry } from './lazyWithRetry';

afterEach(() => vi.useRealTimers());

describe('lazy chunk retry', () => {
  it('should recover a transient chunk failure within a bounded retry budget', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const component = { default: () => null };
    const pending = lazyWithRetry(async () => {
      calls++;
      if (calls === 1) throw new Error('network unavailable');
      return component;
    });
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toBe(component);
    expect(calls).toBe(2);
  });

  it('should stop retrying when the chunk remains unavailable', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const pending = lazyWithRetry(async () => {
      calls++;
      throw new Error('chunk unavailable');
    }, 1);
    const check = expect(pending).rejects.toThrow('chunk unavailable');
    await vi.runAllTimersAsync();
    await check;
    expect(calls).toBe(2);
  });
});
