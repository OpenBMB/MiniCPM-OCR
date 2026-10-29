import type { AppLocale } from '@map/store';

import type { PlaygroundRuntimeContext } from '@/api/map/chat';

/**
 * Collect the browser-context hints a Playground request needs.
 * @param locale current Portal application language
 * @param userLocation current location the user set manually (used by the datetime tool to answer location questions)
 * @param now current browser time, used only to read the UTC offset
 * @returns timezone and language hints that do not include the browser's current instant
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
