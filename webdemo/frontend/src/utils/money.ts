/**
 * 金额 / 额度展示格式化工具。
 *
 * 后端金额为高精度 numeric 字符串（如 "12.34000000"），直接展示尾部零冗余。
 * 这里统一裁掉无意义的尾零，并对空/非法值给出占位。
 */
import type { AppLocale } from '@map/store';

/**
 * 格式化金额为两位小数，用于余额、花费等展示场景。
 * @param value 高精度金额字符串；空/非法时返回 "0.00"
 * @returns 两位小数的金额文本
 */
export function formatMoney(value?: string | null): string {
  if (value == null || value === '') return '0.00';
  const num = Number(value);
  if (Number.isNaN(num)) return value;
  return num.toFixed(2);
}

/**
 * 格式化固定 4 位小数金额，适用于模型定价等需要精度显式展示的价格场景。
 * @param value 高精度金额字符串；空/非法时返回 "0.0000"
 * @returns 固定 4 位小数的金额文本
 */
export function formatMoneyFixed4(value?: string | null): string {
  if (value == null || value === '') return '0.0000';
  const num = Number(value);
  if (Number.isNaN(num)) return value;
  return num.toFixed(4);
}

/**
 * 格式化可空额度（后端 NullDecimal：{ Decimal, Valid }）。
 * @param quota NullDecimal 结构；未设置时表示「不限」
 * @returns 额度文本或「不限」
 */
export function formatQuota(quota?: { Decimal: string; Valid: boolean } | null): string {
  if (!quota || !quota.Valid) return '不限';
  return formatMoney(quota.Decimal);
}

/**
 * 账本金额与积分保持 1:1；对外只展示积分，不再进行兑换换算。
 */
function parsePoints(value?: string | null): number | null {
  if (value == null || value === '') return null;
  const num = Number(value);
  if (Number.isNaN(num)) return null;
  return num;
}

/**
 * 格式化余额 / 花费为固定两位小数积分并添加千分位。
 * 模型调用的单次消耗可能小于 1 积分，仍按统一精度展示。
 * @param value 高精度元金额字符串；空/非法时返回 "0"
 * @returns 带千分位的积分文本（不含单位）
 */
export function formatPoints(value?: string | null, locale: AppLocale = 'zh-CN'): string {
  const pts = parsePoints(value);
  if (pts == null) return '0';
  return pts.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * 格式化模型定价为「积分 / 1M tokens」，统一固定两位小数。
 * 零值、空值或非法值代表未配置可计费价格，统一展示为「-」。
 * @param value 高精度元单价字符串（每 1M tokens）
 * @returns 积分单价文本（不含单位）或「-」
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
 * 格式化可空额度为积分（后端 NullDecimal）；未设置表示「不限」。
 * @param quota NullDecimal 结构
 * @returns 积分文本或「不限」
 */
export function formatPointsQuota(quota?: { Decimal: string; Valid: boolean } | null): string {
  if (!quota || !quota.Valid) return '不限';
  return formatPoints(quota.Decimal);
}
