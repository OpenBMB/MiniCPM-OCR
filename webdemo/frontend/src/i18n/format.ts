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
 * 按当前界面语言格式化数值。
 * @param value 待格式化数值。
 * @param locale 当前界面语言。
 * @returns 面向界面展示的本地化数值。
 */
export function formatNumber(value: number, locale: AppLocale): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(value);
}

/**
 * 按当前界面语言格式化日期。
 * @param value 待格式化日期。
 * @param locale 当前界面语言。
 * @returns 面向界面展示的本地化日期。
 */
export function formatDate(value: Date, locale: AppLocale): string {
  return new Intl.DateTimeFormat(locale, DATE_FORMAT_OPTIONS).format(value);
}

/**
 * 按当前界面语言和平台业务时区格式化日期时间。
 * @param value 待格式化日期。
 * @param locale 当前界面语言。
 * @returns 面向界面展示的本地化日期时间。
 */
export function formatDateTime(value: Date, locale: AppLocale): string {
  return new Intl.DateTimeFormat(locale, DATE_TIME_FORMAT_OPTIONS).format(value);
}
