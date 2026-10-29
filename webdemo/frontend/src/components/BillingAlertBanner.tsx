import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAlertConfigsQuery, useBillingAccountQuery, type MapAlertConfig } from '@/api/map';
import { formatPoints } from '@/utils/money';
import { useAppStore } from '@map/store';

/** NullDecimal → number（未设置时返回 null 表示「不限」） */
function quotaNum(q?: { Decimal: string; Valid: boolean } | null): number | null {
  if (!q || !q.Valid) return null;
  const n = Number(q.Decimal);
  return Number.isFinite(n) ? n : null;
}

interface Alert {
  level: 'error' | 'warning';
  text: string;
}

/** 依据账户状态与预警配置，计算需要展示的最高优先级提醒 */
function evaluate(
  account: ReturnType<typeof useBillingAccountQuery>['data'],
  configs: MapAlertConfig[],
  locale: 'zh-CN' | 'en-US',
  t: (key: string, options?: Record<string, string>) => string,
): Alert | null {
  if (!account?.billing_enabled) return null;

  const balance = Number(account.balance ?? 0);
  // 关键级：欠费或余额耗尽。
  if (account.financial_status === 'ARREARS') {
    return { level: 'error', text: t('billingAlert.inArrears') };
  }
  if (balance <= 0) {
    return { level: 'error', text: t('billingAlert.balanceExhausted') };
  }

  const cfg = (scope: MapAlertConfig['scope']) =>
    configs.find((c) => c.scope === scope && c.enabled);

  // 余额预警（金额阈值）。阈值存储为元，对外统一以积分展示。
  const bal = cfg('BALANCE');
  if (bal?.threshold_amount?.Valid) {
    const threshold = Number(bal.threshold_amount.Decimal);
    if (Number.isFinite(threshold) && balance <= threshold) {
      return {
        level: 'warning',
        text: t('billingAlert.balanceBelowThreshold', {
          amount: formatPoints(bal.threshold_amount.Decimal, locale),
        }),
      };
    }
  }

  // 月额度用量百分比预警。
  const monthQuota = quotaNum(account.monthly_quota);
  const month = cfg('MONTHLY');
  if (month?.threshold_percent != null && monthQuota && monthQuota > 0) {
    const used = (Number(account.month_spend ?? 0) / monthQuota) * 100;
    if (used >= month.threshold_percent) {
      return {
        level: 'warning',
        text: t('billingAlert.monthlyQuotaThreshold', { percent: used.toFixed(0) }),
      };
    }
  }

  // 日额度用量百分比预警。
  const dayQuota = quotaNum(account.daily_quota);
  const day = cfg('DAILY');
  if (day?.threshold_percent != null && dayQuota && dayQuota > 0) {
    const used = (Number(account.today_spend ?? 0) / dayQuota) * 100;
    if (used >= day.threshold_percent) {
      return {
        level: 'warning',
        text: t('billingAlert.dailyQuotaThreshold', { percent: used.toFixed(0) }),
      };
    }
  }

  return null;
}

/**
 * 顶部计费预警横幅（全局）。
 *
 * 触发：账户已开通计费且处于欠费/余额耗尽（error）或命中用户配置的余额/额度预警阈值（warning）。
 * 视觉：error 用 destructive 色、warning 用 warning 色；附「前往总览」入口。
 */
export function BillingAlertBanner() {
  const { t } = useTranslation('shell');
  const locale = useAppStore((state) => state.locale);
  const account = useBillingAccountQuery();
  const configs = useAlertConfigsQuery();
  const alert = evaluate(account.data, configs.data?.list ?? [], locale, t);
  if (!alert) return null;

  const isError = alert.level === 'error';
  const color = isError
    ? 'border-destructive/30 bg-destructive/10 text-destructive'
    : 'border-warning/30 bg-warning/10 text-warning';

  return (
    <div className={`mb-4 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${color}`}>
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-0.5 shrink-0"
        aria-hidden
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <div className="flex-1">
        <p className="font-medium">{alert.text}</p>
        <Link
          to="/"
          className="mt-0.5 inline-block text-xs underline underline-offset-2 hover:opacity-80"
        >
          {t('billingAlert.openOverview')}
        </Link>
      </div>
    </div>
  );
}
