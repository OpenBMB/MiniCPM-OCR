import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Loader2, RefreshCw } from 'lucide-react';
import { Button, Card, cn, Empty } from '@map/ui';

import type { imageParseQuality } from '../../utils/imageParseQuality';
import { qualityExcerpt, imageParseBlockCanRegenerate } from '../../utils/imageParseQuality';
import type { ImageParseTextRange } from '../../utils/imageParseBlocks';
import { WORKSPACE_ICON_CONTROL } from '../../utils/imageParseWorkspaceStyles';
import { ImageParseComparison } from './ImageParseComparison';
import type { ImageParseRegeneration } from '../../utils/imageParseRegeneration';

interface ImageParseReviewPaneProps {
  quality: ReturnType<typeof imageParseQuality>;
  dirty: boolean;
  loading: boolean;
  selectedBlockId?: string;
  ranges: ReadonlyMap<string, ImageParseTextRange>;
  onSelectBlock?: (id: string) => void;
  results?: Readonly<Record<string, ImageParseRegeneration>>;
  pending?: ReadonlySet<string>;
  busy?: boolean;
  regenerationAvailable?: boolean;
  regenerationUnavailableReason?: string;
  onRegenerateBlock?: (id: string) => void;
  all: boolean;
  limit: number;
  onLoadMore: () => void;
}

/** Pending-review items reuse the standard card; after regeneration, show the two-version comparison inside the same card and do not expand the original again. */
export function ImageParseReviewPane({
  quality,
  dirty,
  loading,
  selectedBlockId,
  ranges,
  onSelectBlock,
  results = {},
  pending = new Set(),
  busy = false,
  regenerationAvailable = false,
  regenerationUnavailableReason,
  onRegenerateBlock,
  all,
  limit,
  onLoadMore,
}: ImageParseReviewPaneProps) {
  const { t } = useTranslation('playground');
  /** The comparison after review is expanded by default; only record blocks that were collapsed, and reset them with the component key when the result changes. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  // Blocks already optimized to a high score still keep a comparison entry, and the optimized result is not hidden just because they left the pending-review set.
  const items = all
    ? quality.scored
    : quality.scored.filter((item) => item.suggested || results[item.id]);
  function toggleComparison(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-4 sm:px-6">
      {!regenerationAvailable && onRegenerateBlock ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t(regenerationUnavailableReason ?? 'imageParseRegenerateUnavailable')}
        </p>
      ) : null}
      {dirty ? (
        <p
          role="status"
          className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground"
        >
          {t('imageParseQualityDirty')}
        </p>
      ) : null}
      {quality.scored.length === 0 ? (
        <Empty
          title={t('imageParseQualityEmpty')}
          description={t('imageParseQualityEmptyHint')}
          className="py-10"
        />
      ) : (
        <div className="scroll-mt-4">
          {items.length === 0 ? (
            <Empty
              title={t('imageParseQualityNoLowScores')}
              description={t('imageParseQualityNoLowScoresHint')}
              className="py-8"
            />
          ) : (
            <>
              <div className="space-y-4">
                {items.slice(0, limit).map((item) => {
                  const selected = selectedBlockId === item.id;
                  // Only blocks with no readable text, such as images or seals, are empty after cleaning, and then they do not take a blank line.
                  const excerpt = qualityExcerpt(item.block);
                  const result = results[item.id];
                  const folded = collapsed.has(item.id);
                  const processing = pending.has(item.id);
                  return (
                    <Card
                      key={item.id}
                      role="article"
                      data-review-item={item.id}
                      className="min-w-0 overflow-hidden shadow-card-hover"
                    >
                      <div
                        className={cn(
                          'flex min-w-0 items-start pr-1 transition-colors duration-150 motion-reduce:transition-none',
                          'hover:bg-muted/30',
                        )}
                      >
                        <Button
                          variant="ghost"
                          disabled={loading}
                          data-review-block-id={item.id}
                          aria-pressed={selected}
                          aria-expanded={result ? !folded : undefined}
                          onClick={() => {
                            if (result) toggleComparison(item.id);
                            onSelectBlock?.(item.id);
                          }}
                          className={cn(
                            'h-auto max-h-60 min-h-12 min-w-0 flex-1 items-start justify-start gap-3 overflow-y-auto whitespace-normal rounded-none px-4 py-3 text-left font-normal',
                            'transition-[background-color,border-color,color] duration-150 motion-reduce:transition-none',
                            'hover:bg-transparent',
                            selected && 'text-foreground',
                          )}
                        >
                          <span
                            data-review-score=""
                            className={cn(
                              'sticky top-0 w-10 shrink-0 text-left font-mono text-sm font-semibold leading-5 tabular-nums',
                              item.suggested ? 'font-medium text-warning' : 'text-muted-foreground',
                            )}
                          >
                            {item.score}
                          </span>
                          <span className="sr-only">
                            {t(
                              item.suggested ? 'imageParseReview' : 'imageParseQualityNoSuggestion',
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            {excerpt ? (
                              <span className="block break-words text-xs leading-5 [overflow-wrap:anywhere]">
                                {excerpt}
                              </span>
                            ) : null}
                            {selected && !ranges.has(item.id) ? (
                              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                                {t('imageParseQualityUnmapped')}
                              </span>
                            ) : null}
                          </span>
                        </Button>
                        {onRegenerateBlock ? (
                          <div
                            data-review-actions=""
                            className="flex min-h-12 shrink-0 items-center gap-0.5 px-1"
                          >
                            {result ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className={cn(
                                  WORKSPACE_ICON_CONTROL,
                                  'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                                )}
                                aria-expanded={!folded}
                                aria-label={t(
                                  folded
                                    ? 'imageParseComparisonExpand'
                                    : 'imageParseComparisonCollapse',
                                )}
                                title={t(
                                  folded
                                    ? 'imageParseComparisonExpand'
                                    : 'imageParseComparisonCollapse',
                                )}
                                onClick={() => toggleComparison(item.id)}
                              >
                                {folded ? (
                                  <ChevronDown className="size-4" aria-hidden="true" />
                                ) : (
                                  <ChevronUp className="size-4" aria-hidden="true" />
                                )}
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className={cn(
                                WORKSPACE_ICON_CONTROL,
                                'text-muted-foreground hover:bg-muted/70 hover:text-foreground disabled:text-muted-foreground/40',
                                processing && 'disabled:opacity-100 disabled:text-primary',
                              )}
                              aria-label={t('imageParseRegenerateBlock')}
                              aria-busy={processing || undefined}
                              title={t(
                                regenerationAvailable
                                  ? 'imageParseRegenerateBlock'
                                  : 'imageParseRegenerateUnavailable',
                              )}
                              disabled={
                                loading ||
                                busy ||
                                !regenerationAvailable ||
                                !ranges.has(item.id) ||
                                !imageParseBlockCanRegenerate(item.block) ||
                                Boolean(result)
                              }
                              onClick={() => onRegenerateBlock(item.id)}
                            >
                              {processing ? (
                                <Loader2
                                  className="size-4 animate-spin motion-reduce:animate-none"
                                  aria-hidden="true"
                                />
                              ) : (
                                <RefreshCw className="size-4" aria-hidden="true" />
                              )}
                            </Button>
                          </div>
                        ) : null}
                      </div>
                      {result && !folded ? <ImageParseComparison result={result} /> : null}
                    </Card>
                  );
                })}
              </div>
              {items.length > limit ? (
                <Button
                  variant="ghost"
                  className="mt-1 w-full text-muted-foreground hover:text-foreground"
                  onClick={onLoadMore}
                >
                  {t('loadMore')}
                </Button>
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}
