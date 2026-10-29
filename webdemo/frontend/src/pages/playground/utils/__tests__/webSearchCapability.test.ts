import { describe, expect, it } from 'vitest';
import { canUsePlaygroundWebSearch } from '../webSearchCapability';

describe('canUsePlaygroundWebSearch', () => {
  it('两个能力位齐备时才放行', () => {
    expect(canUsePlaygroundWebSearch({ web_search: true, function_call: true })).toBe(true);
  });

  // This one matters: a model with only web_search checked will not actually search; it fabricates a tool call and then an answer with fake citations,
  // so the entry check must also require function_call, matching the two backend entry points.
  it('缺少 function_call 时不展示联网入口', () => {
    expect(canUsePlaygroundWebSearch({ web_search: true, function_call: false })).toBe(false);
    expect(canUsePlaygroundWebSearch({ web_search: true })).toBe(false);
  });

  it('缺少 web_search 或能力配置缺省时不展示联网入口', () => {
    expect(canUsePlaygroundWebSearch({ web_search: false, function_call: true })).toBe(false);
    expect(canUsePlaygroundWebSearch({})).toBe(false);
    expect(canUsePlaygroundWebSearch(undefined)).toBe(false);
  });
});
