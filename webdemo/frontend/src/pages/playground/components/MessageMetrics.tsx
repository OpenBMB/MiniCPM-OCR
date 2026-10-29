/**
 * Performance-metrics row at the bottom of an assistant message.
 *
 * Purpose: present one generation's timing and usage (first token / total duration / output rate / total tokens called) as one compact row separated by vertical rules; values are highlighted, metric names are muted, and some items have an info hover. Pure display component: no state or side effects. Data is derived by buildMetricItems and passed in by the parent.
 */

import { Tooltip, TooltipContent, TooltipTrigger } from '@map/ui';
import { useTranslation } from 'react-i18next';
import type { TokenUsage } from '@/api/map/chat';
import type { MessageMetrics } from '../types';
import { buildMetricItems, type MetricItem } from '../utils/metrics';

interface MessageMetricsProps {
  metrics?: MessageMetrics;
  usage?: TokenUsage;
}

/**
 * Renders the metrics row for one message; render nothing when there is no metric to show.
 * @param metrics Frontend timing metrics
 * @param usage Trailing-chunk token usage
 */
export function MessageMetrics({ metrics, usage }: MessageMetricsProps) {
  const items = buildMetricItems(metrics, usage);
  if (items.length === 0) return null;

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
      {items.map((item, i) => (
        <div key={item.label} className="flex items-center gap-3">
          {i > 0 && <span className="h-3 w-px bg-border" aria-hidden />}
          <MetricCell item={item} />
        </div>
      ))}
    </div>
  );
}

/** One metric unit: metric name + highlighted value + unit + (optional) info hover */
function MetricCell({ item }: { item: MetricItem }) {
  const { t } = useTranslation('playground');
  return (
    <span className="inline-flex items-center gap-1">
      <span>{item.label}</span>
      <span className="font-semibold tabular-nums text-foreground">{item.value}</span>
      {item.unit && <span className="text-muted-foreground/70">{item.unit}</span>}
      {item.hint && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t('metricInfo', { label: item.label })}
              className="text-muted-foreground/50 transition-colors hover:text-muted-foreground"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </button>
          </TooltipTrigger>
          <TooltipContent>{item.hint}</TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}
