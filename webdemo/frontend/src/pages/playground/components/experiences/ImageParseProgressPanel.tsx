/**
 * Parse progress panel.
 *
 * Purpose: the waiting view while parsing. Shared examples use a fixed demo progress on the frontend; when the real service does not provide progress, stay indeterminate. When the server later returns real progress, the same component can show determinate progress directly.
 */

import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Progress } from '@map/ui';
import type { ImageParseProgressSnapshot } from '../../utils/imageParseSimulation';

interface ImageParseProgressPanelProps {
  progress: ImageParseProgressSnapshot | null;
}

/**
 * Minimal progress view while parsing.
 * @param progress Current progress snapshot
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
