import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ListFilter, Loader2, RefreshCw, Table2, Undo2 } from 'lucide-react';
import {
  Button,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
  useToast,
} from '@map/ui';

import type { ImageParseDraft } from '../../hooks/useImageParseDraft';
import type { useImageParseExampleMerge } from '../../hooks/useImageParseExampleMerge';
import type { useImageParseTableMerge } from '../../hooks/useImageParseTableMerge';
import type { useImageParseRegeneration } from '../../hooks/useImageParseRegeneration';
import type { usePdfImageParse } from '../../hooks/usePdfImageParse';
import { IMAGE_PARSE_REVIEW_ENABLED } from '../../utils/imageParseFeatureFlags';
import type { ImageParseDownloadFormat } from '../../utils/imageParseExport';
import { WORKSPACE_CONTROL, WORKSPACE_TOOLBAR } from '../../utils/imageParseWorkspaceStyles';
import { ImageParseDisplaySettings } from './ImageParseDisplaySettings';
import { ImageParseOptionInfo } from './ImageParseOptionInfo';
import { ImageParseRecognitionSettings } from './ImageParseRecognitionSettings';
import { ImageParseResultActions } from './ImageParseResultActions';
import { ImageParseToolButton } from './ImageParseToolButton';

const TABS_CLASS = cn(
  'h-auto min-h-10 min-w-0 max-w-full flex-initial justify-start gap-0 self-stretch overflow-x-auto rounded-none bg-transparent p-0 [@media(pointer:coarse)]:min-h-11',
  '[&>[data-map-tabs-indicator]]:rounded-none [&>[data-map-tabs-indicator]]:bg-transparent',
  '[&>[data-map-tabs-indicator]]:shadow-none [&>[data-map-tabs-indicator]]:border-b-2',
  '[&>[data-map-tabs-indicator]]:border-primary',
);
const TRIGGER_CLASS =
  'h-full shrink-0 rounded-none px-2 text-xs font-medium text-muted-foreground hover:text-foreground data-[state=active]:text-primary';

interface ImageParseResultToolbarProps {
  loading: boolean;
  error?: string;
  reviewCount: number;
  draft: ImageParseDraft;
  linked: boolean;
  onToggleLinked?: () => void;
  showBlocks?: boolean;
  hasBlocks?: boolean;
  onToggleBlocks?: () => void;
  upright?: boolean;
  onUprightChange?: (enabled: boolean) => void;
  recognizeSeal?: boolean;
  onRecognizeSealChange?: (enabled: boolean) => void;
  recognizeChart?: boolean;
  onRecognizeChartChange?: (enabled: boolean) => void;
  regeneration?: ReturnType<typeof useImageParseRegeneration>;
  downloading?: boolean;
  onDownload?: (format: ImageParseDownloadFormat) => void;
  /** Current view; the pending-review page shows filters and regeneration, and does not show linkage or export. */
  activeTab?: string;
  /** Custom tab copy for non-Markdown results such as key information extraction. */
  previewLabel?: string;
  sourceLabel?: string;
  /** Table merge, header/footer, and two-column linkage are shown only for document results. */
  documentCommands?: boolean;
  /** Show the unified settings entry only when there is already a stable recognition result. */
  settingsVisible?: boolean;
  /** Stats and actions for the current task, sharing one toolbar with the view switch. */
  resultCommands?: ReactNode;
  /** Temporary switch: whether to show the pending-review page. */
  reviewEnabled?: boolean;
  hasScoredBlocks?: boolean;
  reviewAll?: boolean;
  onToggleReviewAll?: () => void;
  /** Only a multi-page PDF or a multi-page example has this: cross-page table merge */
  tableMerge?:
    | ReturnType<typeof usePdfImageParse>['tableMerge']
    | ReturnType<typeof useImageParseExampleMerge>
    | ReturnType<typeof useImageParseTableMerge>;
}

/**
 * Result-column tool area: switch views on the left, and gather the current view's actions on the right. Pending review shows filters and batch regeneration; a narrow column wraps automatically and does not squeeze labels and actions.
 */
export function ImageParseResultToolbar({
  loading,
  error,
  reviewCount,
  draft,
  linked,
  onToggleLinked,
  showBlocks = false,
  hasBlocks = false,
  onToggleBlocks,
  upright,
  onUprightChange,
  recognizeSeal,
  onRecognizeSealChange,
  recognizeChart,
  onRecognizeChartChange,
  regeneration,
  downloading,
  onDownload,
  activeTab,
  previewLabel,
  sourceLabel,
  documentCommands = true,
  settingsVisible = false,
  resultCommands,
  reviewEnabled = IMAGE_PARSE_REVIEW_ENABLED,
  hasScoredBlocks = false,
  reviewAll = false,
  onToggleReviewAll,
  tableMerge,
}: ImageParseResultToolbarProps) {
  const { t } = useTranslation('playground');
  const status = t(loading ? 'imageParseParsing' : 'imageParseCompleted');
  const editStatus = t(draft.manuallyEdited === false ? 'imageParseUpdated' : 'imageParseEdited');
  const reviewOnly = reviewEnabled && activeTab === 'review';
  const showCommands = !reviewOnly && Boolean(onToggleLinked || onDownload);
  return (
    <div className="shrink-0 bg-card">
      <div data-result-navigation="" className={cn(WORKSPACE_TOOLBAR, 'justify-between gap-x-2')}>
        <TabsList className={TABS_CLASS}>
          <TabsTrigger value="preview" className={TRIGGER_CLASS}>
            {previewLabel ?? t('imageParsePreview')}
          </TabsTrigger>
          <TabsTrigger value="source" className={TRIGGER_CLASS}>
            {sourceLabel ?? t('imageParseSource')}
          </TabsTrigger>
          {/* The edit note follows the source tab and is shown on icon hover, so it no longer takes the action area on the right. */}
          {documentCommands && !reviewOnly ? (
            <ImageParseOptionInfo
              label={t('imageParseInlineEditor')}
              hint={t(loading ? 'documentWaitToEdit' : 'imageParseEditHint')}
            />
          ) : null}
          {reviewEnabled ? (
            <TabsTrigger value="review" className={TRIGGER_CLASS}>
              {t('imageParseReview')}
              {reviewCount > 0 ? (
                <span className="ml-1 rounded-full bg-destructive px-1.5 text-[10px] tabular-nums text-destructive-foreground">
                  {reviewCount}
                </span>
              ) : null}
            </TabsTrigger>
          ) : null}
        </TabsList>
        <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1 py-1 text-[11px] text-muted-foreground">
          {resultCommands}
          {draft.dirty ? (
            <span title={editStatus} className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
              <span className="sr-only">{editStatus}</span>
            </span>
          ) : null}
          {reviewOnly && hasScoredBlocks ? (
            <div data-review-commands="" className="flex shrink-0 items-center gap-1">
              {onToggleReviewAll ? (
                <ImageParseToolButton
                  label={t(reviewAll ? 'imageParseQualityOnlySuggested' : 'imageParseQualityAll')}
                  pressed={reviewAll}
                  onClick={onToggleReviewAll}
                  className={reviewAll ? 'bg-muted text-foreground' : undefined}
                >
                  <ListFilter className="size-4" aria-hidden="true" />
                </ImageParseToolButton>
              ) : null}
              {regeneration ? (
                <span
                  data-tour="image-parse-review-batch"
                  aria-busy={regeneration.busy || undefined}
                  className="inline-flex"
                >
                  <ImageParseToolButton
                    label={t(
                      regeneration.busy ? 'imageParseRegenerating' : 'imageParseRegenerateAll',
                    )}
                    hint={
                      !regeneration.available
                        ? t(regeneration.unavailableReason ?? 'imageParseRegenerateUnavailable')
                        : undefined
                    }
                    className="bg-primary text-primary-foreground shadow-none hover:bg-primary/90 hover:text-primary-foreground"
                    disabled={
                      loading ||
                      regeneration.busy ||
                      !regeneration.available ||
                      !regeneration.eligibleLowCount
                    }
                    onClick={() => void regeneration.regenerateLowBlocks()}
                  >
                    <RefreshCw className="size-4" aria-hidden="true" />
                  </ImageParseToolButton>
                </span>
              ) : null}
            </div>
          ) : null}
          {!error ? (
            <span
              role="status"
              title={status}
              className={cn('inline-flex items-center gap-1', !loading && 'sr-only')}
            >
              {loading ? (
                <Loader2
                  className="size-3 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : null}
              <span className="sr-only">{status}</span>
            </span>
          ) : null}
          {draft.dirty ? (
            <ImageParseToolButton
              label={t('imageParseResetDraft')}
              hint={t('imageParseResetDraftHint')}
              onClick={draft.reset}
              showLabel
            >
              <Undo2 className="size-4" aria-hidden="true" />
            </ImageParseToolButton>
          ) : null}
          {showCommands ? (
            <div
              data-result-commands=""
              className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-0.5"
            >
              {documentCommands && tableMerge?.enabled ? (
                <ImageParseTableMergeButton tableMerge={tableMerge} />
              ) : null}
              {documentCommands && settingsVisible ? (
                <>
                  {upright !== undefined &&
                  onUprightChange !== undefined &&
                  recognizeSeal !== undefined &&
                  onRecognizeSealChange !== undefined ? (
                    <ImageParseRecognitionSettings
                      upright={upright}
                      onUprightChange={onUprightChange}
                      recognizeSeal={recognizeSeal}
                      onRecognizeSealChange={onRecognizeSealChange}
                      recognizeChart={recognizeChart}
                      onRecognizeChartChange={onRecognizeChartChange}
                      disabled={loading}
                    />
                  ) : null}
                  <ImageParseDisplaySettings
                    showBlocks={showBlocks}
                    hasBlocks={hasBlocks}
                    onToggleBlocks={onToggleBlocks ?? (() => undefined)}
                    linked={linked}
                    onToggleLinked={onToggleLinked}
                    disabled={loading}
                  />
                </>
              ) : null}
              <ImageParseResultActions
                loading={loading}
                regeneration={regeneration}
                downloading={downloading}
                onDownload={onDownload}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Cross-page table merge: a button with text, progress while merging, undo after it finishes, and the result reported with a toast. */
function ImageParseTableMergeButton({
  tableMerge,
}: {
  tableMerge: NonNullable<ImageParseResultToolbarProps['tableMerge']>;
}) {
  const { t } = useTranslation('playground');
  const { toast } = useToast();
  const merging = tableMerge.status === 'merging';
  const merged = tableMerge.status === 'merged';
  const disabled = merging || (!merged && !tableMerge.available);
  const singleImage = 'scope' in tableMerge && tableMerge.scope === 'singleImage';
  let hint = t(singleImage ? 'imageParseMergeImageTablesPending' : 'imageParseMergeTablesPending');
  let label = t(singleImage ? 'imageParseMergeImageTables' : 'imageParseMergeTables');
  let icon = <Table2 className="size-3.5" aria-hidden="true" />;
  if (merged) {
    hint = t('imageParseUnmergeTables');
    label = t('imageParseUnmergeTables');
    icon = <Undo2 className="size-3.5" aria-hidden="true" />;
  } else if (tableMerge.available) {
    hint = t(singleImage ? 'imageParseMergeImageTablesHint' : 'imageParseMergeTablesHint');
  }
  if (merging) {
    label = t('imageParseMergingTables');
    icon = (
      <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
    );
  }

  async function handleClick() {
    if (merged) {
      tableMerge.unmerge();
      toast({ title: t('imageParseTablesUnmerged') });
      return;
    }
    try {
      const count = await tableMerge.merge();
      toast({
        title: count
          ? t(singleImage ? 'imageParseImageTablesMerged' : 'imageParseTablesMerged', {
              count,
            })
          : t(singleImage ? 'imageParseNoImageTables' : 'imageParseNoCrossPageTables'),
      });
    } catch {
      toast({
        title: t(singleImage ? 'imageParseMergeImageTablesFailed' : 'imageParseMergeTablesFailed'),
        variant: 'error',
      });
    }
  }

  const button = (
    <Button
      type="button"
      variant="ghost"
      data-table-merge={tableMerge.status}
      aria-pressed={merged}
      aria-busy={merging}
      disabled={disabled}
      onClick={() => void handleClick()}
      className={cn(
        WORKSPACE_CONTROL,
        'gap-1.5 text-muted-foreground hover:text-foreground',
        (merging || merged) && 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
      )}
    >
      {icon}
      <span>{label}</span>
    </Button>
  );
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          {disabled ? (
            // A natively disabled button does not receive pointer or focus. The outer layer carries the hint, and the button stays non-executable.
            <span
              tabIndex={0}
              className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
            >
              {button}
            </span>
          ) : (
            button
          )}
        </TooltipTrigger>
        <TooltipContent className="max-w-64 text-xs leading-5" side="bottom">
          {hint}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
