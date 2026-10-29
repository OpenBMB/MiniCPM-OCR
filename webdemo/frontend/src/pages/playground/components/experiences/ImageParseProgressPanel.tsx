/**
 * 解析进度面板。
 *
 * 用途：解析等待视图。共享案例使用前端固定演示进度；真实服务未提供进度时保持 indeterminate。
 * 服务端将来返回真实进度时，同一组件可直接展示确定性进度。
 */

import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Progress } from '@map/ui';
import type { ImageParseProgressSnapshot } from '../../utils/imageParseSimulation';

interface ImageParseProgressPanelProps {
  progress: ImageParseProgressSnapshot | null;
}

/**
 * 解析中的极简进度视图。
 * @param progress 当前进度快照
 */
export function ImageParseProgressPanel({ progress }: ImageParseProgressPanelProps) {
  const { t } = useTranslation('playground');
  const percent = progress?.percent;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col px-6 py-8 animate-[map-fade-in_0.25s_ease] motion-reduce:animate-none"
      aria-busy="true"
      role="status"
    >
      <div className="w-full">
        <div className="flex items-center justify-between gap-3 text-sm" aria-live="polite">
          <span className="flex min-w-0 items-center gap-2 text-foreground">
            <Loader2
              className="size-4 shrink-0 animate-spin text-primary motion-reduce:animate-none"
              aria-hidden="true"
            />
            <span className="truncate">{t('imageParseParsing')}</span>
          </span>
          {percent != null ? (
            <span className="shrink-0 tabular-nums text-muted-foreground">{percent}%</span>
          ) : null}
        </div>
        <Progress
          className="mt-3"
          value={percent}
          indeterminate={percent == null}
          aria-label={t('imageParseProgressLabel')}
        />
      </div>
    </div>
  );
}
