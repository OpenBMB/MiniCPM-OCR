/**
 * 助手消息底部的性能指标行。
 *
 * 用途：把一轮生成的计时与用量（首 token / 总耗时 / 输出速率 / 共调用 tokens）
 * 呈现为一行带竖线分隔的紧凑指标；数值高亮、指标名弱化，部分项带 info 悬浮说明。
 * 纯展示组件：不含状态与副作用，数据经 buildMetricItems 派生后由父组件传入。
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
 * 渲染一条消息的指标行；无任何可展示指标时不渲染。
 * @param metrics 前端计时指标
 * @param usage 尾块 token 用量
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

/** 单个指标单元：指标名 + 高亮数值 + 单位 +（可选）info 悬浮 */
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
