import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@map/ui';

import { imageParseConfidence } from '../../utils/imageParseBlocks';
import {
  imageParseTextDifference,
  type ImageParseRegeneration,
} from '../../utils/imageParseRegeneration';

interface ImageParseComparisonProps {
  result: ImageParseRegeneration;
}

/**
 * 单块复核的前后对比：当前最优在左、原始在右，窄屏时最优结果优先展示。
 * @param result 该块的重生成结果（原始、最优、差异与轮次信息）
 */
export function ImageParseComparison({ result }: ImageParseComparisonProps) {
  const { t } = useTranslation('playground');
  const difference = useMemo(
    () => imageParseTextDifference(result.original.markdown, result.best.markdown),
    [result.original.markdown, result.best.markdown],
  );
  return (
    <div
      // 未提升时直接展示两版正文，不为隐藏的说明保留空白信息栏。
      className="border-t border-border/60"
      data-regeneration-comparison
    >
      {result.error || result.improved ? (
        <div className="bg-muted/30 px-4 py-2">
          {result.error ? (
            <p role="alert" className="break-words text-xs leading-5 text-destructive">
              {t(result.error)}
            </p>
          ) : (
            <p role="status" className="break-words text-xs font-medium leading-5 text-success">
              {t('imageParseRegenerateImproved')}
            </p>
          )}
        </div>
      ) : null}
      <div className="grid divide-y divide-border/60 md:grid-cols-2 md:divide-x md:divide-y-0">
        {(['best', 'original'] as const).map((version) => (
          <section
            key={version}
            aria-label={t(
              version === 'best' ? 'imageParseBestVersion' : 'imageParseOriginalVersion',
            )}
            className="min-w-0 px-4 py-3"
          >
            <div
              className={cn(
                'mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs leading-5',
                version === 'best'
                  ? 'font-medium text-primary'
                  : 'font-medium text-muted-foreground',
              )}
            >
              <span className="min-w-0 break-words">
                {t(version === 'best' ? 'imageParseBestVersion' : 'imageParseOriginalVersion')}
              </span>
              <span className="shrink-0 font-mono tabular-nums">
                {imageParseConfidence(result[version].confidence)}
              </span>
            </div>
            <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-6 [overflow-wrap:anywhere]">
              {difference.prefix}
              {(version === 'best' ? difference.after : difference.before) ? (
                <mark
                  className={cn(
                    'rounded-sm text-foreground',
                    version === 'best' ? 'bg-success/20' : 'bg-warning/20',
                  )}
                >
                  {version === 'best' ? difference.after : difference.before}
                </mark>
              ) : null}
              {difference.suffix}
            </pre>
          </section>
        ))}
      </div>
    </div>
  );
}
