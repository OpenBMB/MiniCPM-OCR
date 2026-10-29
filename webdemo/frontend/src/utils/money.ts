/**
 * Amount and quota display formatting.
 *
 * Backend amounts are high-precision numeric strings (for example "12.34000000"); showing them raw leaves trailing zeros.
 * Strip meaningless trailing zeros here, and use a placeholder for empty or invalid values.
 */
import type { AppLocale } from '@map/store';

/**
 * Format an amount to two decimal places, for balances, spend, and similar display.
 * @param value High-precision amount string; empty or invalid returns "0.00".
 * @returns Amount text with two decimal places.
 */
export function formatMoney(value?: string | null): string {
  if (value == null || value === '') return '0.00';
  const num = Number(value);
  if (Number.isNaN(num)) return value;
  return num.toFixed(2);
}

/**
 * Format an amount to a fixed 4 decimal places, for prices such as model pricing that should show precision explicitly.
 * @param value High-precision amount string; empty or invalid returns "0.0000".
 * @returns Amount text with a fixed 4 decimal places.
 */
export function formatMoneyFixed4(value?: string | null): string {
  if (value == null || value === '') return '0.0000';
  const num = Number(value);
  if (Number.isNaN(num)) return value;
  return num.toFixed(4);
}

/**
 * Format a nullable quota (backend NullDecimal: { Decimal, Valid }).
 * @param quota NullDecimal value; unset means "unlimited".
 * @returns Quota text, or "unlimited".
 */
export function formatQuota(quota?: { Decimal: string; Valid: boolean } | null): string {
  if (!quota || !quota.Valid) return '不限';
  return formatMoney(quota.Decimal);
}

/**
 * Ledger amounts and points stay 1:1; only points are shown, with no exchange conversion.
 */
function parsePoints(value?: string | null): number | null {
  if (value == null || value === '') return null;
  const num = Number(value);
  if (Number.isNaN(num)) return null;
  return num;
}

/**
 * Format a balance or spend as points with two fixed decimal places and thousands separators.
 * A single model call can cost less than 1 point and is still shown at the same precision.
 * @param value High-precision yuan amount string; empty or invalid returns "0".
 * @returns Points text with thousands separators (no unit).
 */
export function formatPoints(value?: string | null, locale: AppLocale = 'zh-CN'): string {
  const pts = parsePoints(value);
  if (pts == null) return '0';
  return pts.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Format model pricing as "points / 1M tokens", always with two decimal places.
 * Zero, empty, or invalid means no billable price is configured, and is shown as "-".
 * @param value High-precision yuan unit price string (per 1M tokens).
 * @returns Points unit-price text (no unit), or "-".
 */
export function formatPointsPerMillion(
  value?: string | null,
  locale: AppLocale = 'zh-CN',
): string {
  const pts = parsePoints(value);
  if (pts == null || pts <= 0) return '-';
  return pts.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Format a nullable quota as points (backend NullDecimal); unset means "unlimited".
 * @param quota NullDecimal value.
 * @returns Points text, or "unlimited".
 */
export function formatPointsQuota(quota?: { Decimal: string; Valid: boolean } | null): string {
  if (!quota || !quota.Valid) return '不限';
  return formatPoints(quota.Decimal);
}
