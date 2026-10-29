import { Button, Card, CardContent } from '@map/ui';
import { Check, Gift, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface DailyCheckinCardProps {
  collapsed: boolean;
  dailyPoints: string;
  enabled: boolean;
  claimedToday: boolean;
  onOpenRecharges: () => void;
}

/**
 * Daily check-in entry in the user portal sidebar: shows today's reward and claims points through the existing idempotent API.
 *
 * @param props Check-in status, sidebar state, and the claim callback.
 * @returns The benefit card for claimable, claiming, claimed, or hidden.
 */
export function DailyCheckinCard({
  collapsed,
  dailyPoints,
  enabled,
  claimedToday,
  onOpenRecharges,
}: DailyCheckinCardProps) {
  const { t, i18n } = useTranslation('billing');
  if (!enabled) return null;

  const points = formatDailyPoints(dailyPoints, i18n.language);
  const canClaim = !claimedToday;

  if (collapsed) {
    return (
      <div className="px-3 pb-2">
        <Button
          type="button"
          variant={canClaim ? 'default' : 'outline'}
          size="icon"
          className="h-11 w-11 rounded-xl shadow-sm"
          onClick={onOpenRecharges}
          aria-label={
            canClaim
              ? t('openCreditsToClaimAria', { amount: points })
              : t('openCreditsAria')
          }
          title={
            canClaim
              ? t('openCreditsToClaimAria', { amount: points })
              : t('openCreditsRecordAria')
          }
        >
          {claimedToday ? <Check className="h-4 w-4" /> : <Gift className="h-4 w-4" />}
        </Button>
      </div>
    );
  }

  return (
    <div className="px-4 pb-3">
      <Card className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-card via-primary/5 to-primary/15 shadow-card">
        <div className="pointer-events-none absolute -right-9 -top-11 h-24 w-24 rounded-full bg-primary/10" />
        <CardContent className="relative p-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-primary">
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              {t('dailyBenefit')}
            </div>
          </div>

          <div className="mt-2.5 flex items-baseline gap-1 text-primary">
            <span className="text-[2rem] font-bold tracking-tight text-foreground">+{points}</span>
            <span className="text-[13px] font-bold">{t('credits')}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {claimedToday ? t('nextClaimAvailable') : t('dailyCheckinRefresh')}
          </p>

          {claimedToday ? (
            <Button
              type="button"
              variant="outline"
              className="mt-2.5 h-9 w-full rounded-xl border-primary/20 bg-primary/10 text-xs font-semibold text-primary hover:bg-primary/15 hover:text-primary"
              onClick={onOpenRecharges}
              aria-label={t('viewCredits')}
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              <span className="ml-2">{t('claimedAndViewRecords')}</span>
            </Button>
          ) : (
            <Button
              type="button"
              className="mt-2.5 h-9 w-full rounded-xl bg-primary text-xs font-semibold shadow-[0_10px_18px_-12px_hsl(var(--primary)/0.9)] hover:bg-primary/90"
              onClick={onOpenRecharges}
              aria-label={t('claimCreditsAria', { amount: points })}
            >
              {t('claimNow')}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Show check-in points as a compact integer; if the campaign configured a fractional reward, keep at most two significant decimal places. */
function formatDailyPoints(value: string, locale: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(amount);
}
