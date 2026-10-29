import { afterEach, describe, expect, it, vi } from 'vitest';

import { collectPlaygroundRuntimeContext } from '../runtimeContext';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('collectPlaygroundRuntimeContext', () => {
  it('采集 IANA 时区、应用语言和东八区 offset', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ timeZone: 'Asia/Shanghai' }),
    } as Intl.DateTimeFormat);
    const now = new Date('2026-09-14T02:30:00.000Z');
    vi.spyOn(now, 'getTimezoneOffset').mockReturnValue(-480);

    expect(collectPlaygroundRuntimeContext('zh-CN', undefined, now)).toEqual({
      timezone: 'Asia/Shanghai',
      locale: 'zh-CN',
      utc_offset_minutes: 480,
    });
  });

  it('浏览器未返回时区时只发送语言和 offset', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ timeZone: '' }),
    } as Intl.DateTimeFormat);
    const now = new Date('2026-09-14T02:30:00.000Z');
    vi.spyOn(now, 'getTimezoneOffset').mockReturnValue(420);

    expect(collectPlaygroundRuntimeContext('en-US', undefined, now)).toEqual({
      locale: 'en-US',
      utc_offset_minutes: -420,
    });
  });
});
