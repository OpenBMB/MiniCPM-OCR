import type { AppLocale } from '@map/store';

const DATE_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: 'medium',
  timeZone: 'UTC',
};

const DATE_TIME_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Shanghai',
};

/**
 * Format a number for the current UI language.
 * @param value Number to format.
 * @param locale Current UI language.
 * @returns Localized number for display.
 */
export function formatNumber(value: number, locale: AppLocale): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(value);
}

/**
 * Format a date for the current UI language.
 * @param value Date to format.
 * @param locale Current UI language.
 * @returns Localized date for display.
 */
export function formatDate(value: Date, locale: AppLocale): string {
  return new Intl.DateTimeFormat(locale, DATE_FORMAT_OPTIONS).format(value);
}

/**
 * Format a date and time for the current UI language and the platform business timezone.
 * @param value Date to format.
 * @param locale Current UI language.
 * @returns Localized date and time for display.
 */
export function formatDateTime(value: Date, locale: AppLocale): string {
  return new Intl.DateTimeFormat(locale, DATE_TIME_FORMAT_OPTIONS).format(value);
}
