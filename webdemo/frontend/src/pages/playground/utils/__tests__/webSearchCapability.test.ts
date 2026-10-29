import { describe, expect, it } from 'vitest';
import { canUsePlaygroundWebSearch } from '../webSearchCapability';

describe('canUsePlaygroundWebSearch', () => {
  it('两个能力位齐备时才放行', () => {
    expect(canUsePlaygroundWebSearch({ web_search: true, function_call: true })).toBe(true);
  });

  // 这条是重点：只勾 web_search 的模型不会真检索，只会捏造一次工具调用再编出带假引用的回答，
  // 因此入口必须连同 function_call 一起判，与后端两条入口保持一致。
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
