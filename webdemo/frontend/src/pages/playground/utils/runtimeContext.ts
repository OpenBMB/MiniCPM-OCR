import type { AppLocale } from '@map/store';

import type { PlaygroundRuntimeContext } from '@/api/map/chat';

/**
 * 采集 Playground 请求所需的浏览器上下文提示。
 * @param locale Portal 当前应用语言
 * @param userLocation 用户手动设置的当前位置（用于 datetime 工具回答地点相关问题）
 * @param now 当前浏览器时间，仅用于读取 UTC offset
 * @returns 不包含浏览器当前时刻的时区与语言提示
 */
export function collectPlaygroundRuntimeContext(
  locale: AppLocale,
  userLocation?: string,
  now = new Date(),
): PlaygroundRuntimeContext {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone.trim();
  return {
    ...(timezone ? { timezone } : {}),
    locale,
    utc_offset_minutes: -now.getTimezoneOffset(),
    ...(userLocation ? { location: userLocation } : {}),
  };
}
