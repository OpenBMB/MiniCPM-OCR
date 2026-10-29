/** Image-parse result column: keep the body mounted when switching views, so it is not parsed again. */

import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn, Empty, Tabs, TabsContent, Textarea } from '@map/ui';
import { isImageParsePipelineMode } from '@/api/map/imageParseSdk';
import type { ImageParseDraft } from '../../hooks/useImageParseDraft';
import type { useImageParse } from '../../hooks/useImageParse';
import { MarkdownRenderer } from '../MarkdownRenderer';
import { useImageParseHighlight } from '../../hooks/useImageParseHighlight';
import { useImageParseReview } from '../../hooks/useImageParseReview';
import { imageParseQuality } from '../../utils/imageParseQuality';
import { IMAGE_PARSE_REVIEW_ENABLED } from '../../utils/imageParseFeatureFlags';
import { ImageParseReviewPane } from './ImageParseReviewPane';
import {
  imageParseBlockId,
  imageParseBlockRanges,
  type ImageParseTextRange,
} from '../../utils/imageParseBlocks';
import type { ImageParseLinkedRange } from '../../utils/imageParseHighlight';
import { imageParsePageNumberRanges } from '../../utils/imageParsePageNumber';
import { ImageParseProgressPanel } from './ImageParseProgressPanel';
import { ImageParseVisualEditor } from './ImageParseVisualEditor';
import { ImageParseResultToolbar } from './ImageParseResultToolbar';
import type { useImageParseRegeneration } from '../../hooks/useImageParseRegeneration';
import type { useImageParseExampleMerge } from '../../hooks/useImageParseExampleMerge';
import type { ImageParseDownloadFormat } from '../../utils/imageParseExport';
import { ImageParsePreviewReview } from './ImageParsePreviewReview';
import { ImageParsePdfPreview } from './ImageParsePdfPreview';
import { ImageParseKiePdfPreview } from './ImageParseKiePdfPreview';
import { ImageParseKieSummary } from './ImageParseKieSummary';
import { ImageParseKieResultCommands } from './ImageParseKieResultCommands';
import { ImageParseResultError } from './ImageParseResultError';
import { imageParseKieValues } from '../../utils/imageParseKie';
import {
  imageParseSealDisplayCrops,
  imageParseSealDisplayResult,
} from '../../utils/imageParseSealDisplay';

type ImageParseState = ReturnType<typeof useImageParse>;

/** Keep mounted across panel switches; do not replay the entrance animation from opacity 0 on every expand. */
const TAB_CONTENT_CLASS = 'mt-0 min-h-0 flex-1 overflow-auto bg-card data-[state=inactive]:hidden';

/** Content padding shared by the three pages. Leave extra at the bottom so the last line does not sit against the column edge when scrolled to the end. */
const PAGE_PADDING = 'px-4 pb-12 pt-4 sm:px-6';

/** The content column is width-limited and centered, so line length does not hurt reading in full-width mode. */
const CONTENT_COLUMN = 'mx-auto w-full max-w-5xl';

interface ImageParseResultPaneProps {
  parse: ImageParseState;
  quality?: ReturnType<typeof imageParseQuality>;
  ranges?: ReadonlyMap<string, ImageParseTextRange>;
  draft: ImageParseDraft;
  previewMarkdown?: string;
  previewLayout?: ReturnType<typeof useImageParse>['layout'];
  previewRanges?: ReadonlyMap<string, ImageParseTextRange>;
  previewLinkedRanges?: readonly ImageParseLinkedRange[];
  previewCrops?: readonly string[];
  previewOnly?: boolean;
  /** Copy the currently selected region; tables are handled by the parent as HTML + TSV */
  onCopyRegion?: (id: string) => void;
  selectedBlockId?: string;
  hoveredBlockId?: string;
  onHoverBlock?: (id: string | undefined, page?: number) => void;
  focusRequest?: number;
  selectedRange?: ImageParseTextRange;
  linkedRanges?: readonly ImageParseLinkedRange[];
  tab?: string;
  /** Temporary switch: whether to show the pending-review page. */
  reviewEnabled?: boolean;
  onTabChange?: (tab: string) => void;
  onSelectBlock?: (id: string, page?: number) => void;
  linked?: boolean;
  onToggleLinked?: () => void;
  showBlocks?: boolean;
  onToggleBlocks?: () => void;
  /** Cross-page table merge for multi-page examples; for a multi-page PDF use parse.pdf.tableMerge. */
  exampleTableMerge?: ReturnType<typeof useImageParseExampleMerge>;
  regeneration?: ReturnType<typeof useImageParseRegeneration>;
  downloading?: boolean;
  onDownload?: (format: ImageParseDownloadFormat) => void;
  onEditFields?: () => void;
  resultPaneRef?: (node: HTMLElement | null) => void;
  previewScrollRef?: (node: HTMLDivElement | null) => void;
  onPreviewScroll?: React.UIEventHandler<HTMLDivElement>;
  onPreviewFocus?: (top: number) => void;
}

/**
 * Markdown result column.
 * @param parse Image-parse orchestration state
 * @param draft Editable draft
 * @param onCopyRegion Copy the currently selected region
 */
export function ImageParseResultPane({
  parse,
  quality,
  ranges,
  draft,
  previewMarkdown,
  previewLayout,
  previewRanges,
  previewLinkedRanges,
  previewCrops,
  previewOnly = false,
  onCopyRegion,
  selectedBlockId,
  hoveredBlockId,
  onHoverBlock,
  focusRequest,
  selectedRange,
  linkedRanges,
  tab,
  reviewEnabled = IMAGE_PARSE_REVIEW_ENABLED,
  onTabChange,
  onSelectBlock,
  linked = true,
  onToggleLinked,
  showBlocks = true,
  onToggleBlocks,
  exampleTableMerge,
  regeneration,
  downloading,
  onDownload,
  onEditFields,
  resultPaneRef,
  previewScrollRef,
  onPreviewScroll,
  onPreviewFocus,
}: ImageParseResultPaneProps) {
  const { t } = useTranslation('playground');
  const { loading, error, layout } = parse;
  const fallbackPreview = useMemo(
    () =>
      imageParseSealDisplayResult(
        { markdown: draft.value, blocks: layout },
        parse.recognizeSeal ?? true,
        parse.recognizeChart ?? true,
        ranges,
      ),
    [draft.value, layout, parse.recognizeChart, parse.recognizeSeal, ranges],
  );
  const shownMarkdown = previewMarkdown ?? fallbackPreview.markdown;
  const shownLayout = previewLayout ?? fallbackPreview.blocks;
  const shownRanges = previewRanges ?? ranges ?? imageParseBlockRanges(shownMarkdown, shownLayout);
  const shownLinkedRanges =
    previewLinkedRanges ?? linkedRanges ?? [...shownRanges].map(([id, range]) => ({ id, range }));
  const shownCrops =
    previewCrops ??
    imageParseSealDisplayCrops(
      layout,
      parse.crops,
      parse.recognizeSeal ?? true,
      parse.recognizeChart ?? true,
    );
  const selectedBlockKind = useMemo(
    () =>
      shownLayout.find((item, index) => imageParseBlockId(item, index) === selectedBlockId)?.kind,
    [shownLayout, selectedBlockId],
  );
  const algorithmMode = parse.mode === 'standard' || isImageParsePipelineMode(parse.mode);
  const showReview = reviewEnabled && !algorithmMode;
  // The page-count note says the original is already open; unfinished pages keep a placeholder so users do not think the result column is unresponsive.
  const continuousPdf = Boolean(parse.pdf?.pages);
  // Seal recognition allows an empty body; as long as real blocks came back, show the result rather than the empty state.
  const hasPreview = Boolean(shownMarkdown || continuousPdf || shownLayout.length > 0);
  const hasStableResult = !loading && (parse.finished || Boolean(parse.pdf?.completed));
  const [localTab, setLocalTab] = useState('preview');
  const requestedTab = tab ?? localTab;
  // Pending review is temporarily hidden; when the outside restores an old view, fall back to preview so it does not stay on invisible content.
  const activeTab = showReview || requestedTab !== 'review' ? requestedTab : 'preview';
  const review = useImageParseReview(parse.resultKey);
  const previewRef = useRef<HTMLElement>(null);
  const computedQuality = useMemo(() => quality ?? imageParseQuality(layout), [quality, layout]);
  const kieValues = useMemo(
    () => (parse.mode === 'kie' ? imageParseKieValues(draft.value) : null),
    [draft.value, parse.mode],
  );
  const kieCommands =
    parse.mode === 'kie' ? (
      <ImageParseKieResultCommands
        content={draft.value}
        fields={parse.fields}
        disabled={loading}
        onEditFields={onEditFields}
      />
    ) : undefined;
  const pageNumberRanges = useMemo(
    () => imageParsePageNumberRanges(shownLayout, shownRanges),
    [shownLayout, shownRanges],
  );
  let emptyDescription = 'imageParseEmptyHint';
  if (previewOnly) emptyDescription = 'imageParseLocalResultHint';
  // A successful review completes the to-do and does not require a higher score; a failure keeps the to-do, and scores and the comparison list are unaffected.
  const reviewCount = computedQuality.suggested.filter((item) => {
    const result = regeneration?.results[item.id];
    return !result || Boolean(result.error);
  }).length;
  useImageParseHighlight(
    previewRef,
    selectedBlockId,
    focusRequest,
    shownMarkdown,
    shownLinkedRanges,
    activeTab,
    selectedRange,
    linked,
    linked ? hoveredBlockId : undefined,
    onPreviewFocus,
  );

  function renderPreviewContent() {
    if (continuousPdf) {
      if (parse.mode === 'kie') {
        return <ImageParseKiePdfPreview parse={parse} draft={draft} />;
      }
      return (
        <ImageParsePdfPreview
          parse={parse}
          draft={draft}
          tab={activeTab}
          linked={linked}
          selectedId={selectedBlockId}
          hoveredId={hoveredBlockId}
          focusRequest={focusRequest}
          onFocus={onPreviewFocus}
          onCopyRegion={onCopyRegion}
          regeneration={showReview ? regeneration : undefined}
          recognizeSeal={parse.recognizeSeal ?? true}
          recognizeChart={parse.recognizeChart ?? true}
        />
      );
    }
    return (
      <>
        {parse.mode === 'kie' ? (
          <ImageParseKieSummary content={draft.value} fields={parse.fields} />
        ) : null}
        {/* After KIE parses successfully, show only the result table, so the same JSON is not rendered again as body text. */}
        {parse.mode === 'kie' && kieValues ? null : (
          <ImageParseVisualEditor
            key={`${parse.resultKey}:${loading}`}
            source={shownMarkdown}
            loading={loading}
            pageNumberRanges={pageNumberRanges}
            onSave={draft.setValue}
          >
            <MarkdownRenderer
              content={shownMarkdown}
              variant="document"
              editableBlocks={Boolean(
                ranges?.size ||
                previewRanges?.size ||
                linkedRanges?.length ||
                previewLinkedRanges?.length ||
                parse.recognizeSeal === true ||
                parse.recognizeChart === true,
              )}
              imageCrops={draft.dirty ? [] : shownCrops}
              streaming={loading}
              highlightRange={shownLinkedRanges.length ? undefined : selectedRange}
              linkedRanges={shownLinkedRanges}
            />
          </ImageParseVisualEditor>
        )}
      </>
    );
  }

  // When switching tabs, keep the body mounted and the solid background, so the content does not go transparent and then appear.
  return (
    <section
      ref={resultPaneRef}
      data-ocr-result-tab={activeTab}
      className="flex h-full min-h-0 flex-col bg-card"
    >
      <ImageParseResultError
        message={continuousPdf ? parse.pdf?.error && t(parse.pdf.error) : error}
        disabled={!parse.canParse}
        onRetry={() => void parse.parse()}
      />
      {!hasPreview && !loading && kieCommands ? (
        <div className="flex shrink-0 justify-end border-b border-border/60 px-3 py-1">
          {kieCommands}
        </div>
      ) : null}

      {loading && !hasPreview ? <ImageParseProgressPanel progress={parse.progress} /> : null}

      {hasPreview ? (
        <Tabs
          defaultValue="preview"
          value={activeTab}
          onValueChange={(value) => {
            setLocalTab(value);
            onTabChange?.(value);
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <ImageParseResultToolbar
            loading={loading}
            error={error}
            reviewCount={reviewCount}
            draft={draft}
            linked={linked}
            onToggleLinked={onToggleLinked}
            showBlocks={showBlocks}
            hasBlocks={Boolean(layout.length || parse.pdf?.completed)}
            onToggleBlocks={onToggleBlocks}
            upright={parse.mode !== 'kie' && parse.mode !== 'seal' ? parse.upright : undefined}
            onUprightChange={
              parse.mode !== 'kie' && parse.mode !== 'seal' ? parse.setUpright : undefined
            }
            recognizeSeal={
              parse.mode !== 'kie' && parse.mode !== 'seal' ? parse.recognizeSeal : undefined
            }
            onRecognizeSealChange={
              parse.mode !== 'kie' && parse.mode !== 'seal' ? parse.setRecognizeSeal : undefined
            }
            recognizeChart={
              parse.mode !== 'kie' && parse.mode !== 'seal' ? parse.recognizeChart : undefined
            }
            onRecognizeChartChange={
              parse.mode !== 'kie' && parse.mode !== 'seal' ? parse.setRecognizeChart : undefined
            }
            tableMerge={
              (parse.pdf?.pages ?? 0) > 1
                ? parse.pdf?.tableMerge
                : (parse.imageTableMerge ?? exampleTableMerge)
            }
            regeneration={regeneration}
            downloading={downloading}
            onDownload={onDownload}
            activeTab={activeTab}
            previewLabel={parse.mode === 'kie' ? t('imageParseKiePreview') : undefined}
            sourceLabel={parse.mode === 'kie' ? t('imageParseKieSource') : undefined}
            documentCommands={parse.mode !== 'kie'}
            settingsVisible={hasStableResult}
            resultCommands={kieCommands}
            reviewEnabled={showReview}
            hasScoredBlocks={computedQuality.scored.length > 0}
            reviewAll={review.all}
            onToggleReviewAll={review.toggleAll}
          />
          <TabsContent
            forceMount
            value="preview"
            data-ocr-result-scroll
            ref={previewScrollRef}
            onScroll={onPreviewScroll}
            className={`${TAB_CONTENT_CLASS} ${PAGE_PADDING}`}
          >
            {/* The body and the top bar share a background color. The page is made by the width limit and whitespace only, and a card is no longer wrapped around it to eat the margin */}
            <article
              ref={continuousPdf ? undefined : previewRef}
              className={cn(
                CONTENT_COLUMN,
                'relative [&_[data-edit-block]:first-child>*:first-child]:mt-0',
                '[&_[data-ocr-highlight=true]:not([data-document-table])]:rounded-sm',
                '[&_[data-ocr-highlight=true]:not([data-document-table])]:ring-1',
                '[&_[data-ocr-highlight=true]:not([data-document-table])]:ring-inset',
                '[&_[data-ocr-highlight=true]:not([data-document-table])]:ring-ocr-link',
                '[&_[data-ocr-hover=true]:not([data-document-table])]:rounded-sm',
                '[&_[data-ocr-hover=true]:not([data-document-table])]:bg-ocr-link/5',
                '[&_[data-ocr-hover=true]:not([data-document-table])]:ring-1',
                '[&_[data-ocr-hover=true]:not([data-document-table])]:ring-inset',
                '[&_[data-ocr-hover=true]:not([data-document-table])]:ring-ocr-link/40',
              )}
              onMouseOver={(event) => {
                if (
                  event.target instanceof HTMLElement &&
                  event.target.closest('[data-visual-editing="true"]')
                )
                  return;
                const id = linkedBlockId(event.target);
                const page = linkedPage(event.target);
                if (page === undefined) onHoverBlock?.(id);
                else onHoverBlock?.(id, page);
              }}
              onMouseLeave={() => onHoverBlock?.(undefined)}
              onClick={(event) => {
                if (
                  event.target instanceof HTMLElement &&
                  event.target.closest('[data-visual-editing="true"]')
                )
                  return;
                if (window.getSelection()?.toString()) return;
                const id = linkedBlockId(event.target);
                if (id) {
                  const page = linkedPage(event.target);
                  if (page === undefined) onSelectBlock?.(id);
                  else onSelectBlock?.(id, page);
                }
              }}
              onKeyDown={(event) => {
                if (
                  event.target instanceof HTMLElement &&
                  event.target.closest('[data-visual-editing="true"]')
                )
                  return;
                if (event.key !== 'Enter' && event.key !== ' ') return;
                const id = linkedBlockId(event.target);
                if (!id) return;
                event.preventDefault();
                const page = linkedPage(event.target);
                if (page === undefined) onSelectBlock?.(id);
                else onSelectBlock?.(id, page);
              }}
            >
              {renderPreviewContent()}
              {!continuousPdf && (onCopyRegion || (showReview && regeneration)) ? (
                <ImageParsePreviewReview
                  root={previewRef}
                  selectedId={selectedBlockId}
                  blockKind={selectedBlockKind}
                  content={shownMarkdown}
                  visible={!loading && activeTab === 'preview'}
                  ranges={shownRanges}
                  regeneration={showReview ? regeneration : undefined}
                  onCopyRegion={onCopyRegion}
                />
              ) : null}
            </article>
          </TabsContent>
          <TabsContent
            forceMount
            value="source"
            className={`${TAB_CONTENT_CLASS} flex flex-col gap-2 ${PAGE_PADDING}`}
          >
            <Textarea
              value={draft.value}
              readOnly={loading}
              onChange={(event) => draft.setValue(event.target.value)}
              aria-label={t('imageParseSource')}
              spellCheck={false}
              className={`${CONTENT_COLUMN} min-h-0 flex-1 resize-none border-transparent px-4 py-3 font-mono text-[13px] leading-6 focus-visible:border-transparent focus-visible:ring-0`}
            />
          </TabsContent>
          {showReview ? (
            <TabsContent forceMount value="review" className={TAB_CONTENT_CLASS}>
              <ImageParseReviewPane
                key={parse.resultKey}
                quality={computedQuality}
                dirty={draft.manuallyEdited ?? draft.dirty}
                loading={loading}
                selectedBlockId={selectedBlockId}
                ranges={shownRanges}
                onSelectBlock={onSelectBlock}
                results={regeneration?.results}
                pending={regeneration?.pending}
                busy={regeneration?.busy}
                regenerationAvailable={regeneration?.available}
                regenerationUnavailableReason={regeneration?.unavailableReason}
                onRegenerateBlock={
                  regeneration ? (id) => void regeneration.regenerateBlock(id) : undefined
                }
                all={review.all}
                limit={review.limit}
                onLoadMore={review.loadMore}
              />
            </TabsContent>
          ) : null}
        </Tabs>
      ) : null}

      {!loading && !error && !hasPreview ? (
        <Empty
          className="flex-1"
          title={t(parse.finished ? 'imageParseNoTextTitle' : 'imageParseEmpty')}
          description={t(parse.finished ? 'imageParseNoTextHint' : emptyDescription)}
        />
      ) : null}
    </section>
  );
}

/** Direct location entry on a document node; links and form controls keep their own interaction. */
function linkedBlockId(target: EventTarget | null): string | undefined {
  if (!(target instanceof HTMLElement) || target.closest('a, button, input, textarea, select')) {
    return undefined;
  }
  return target.closest<HTMLElement>('[data-ocr-block-id]')?.dataset.ocrBlockId;
}

/** The clicked result page provides page-level location context; the image preview keeps the original single-argument event. */
function linkedPage(target: EventTarget | null): number | undefined {
  if (!(target instanceof HTMLElement)) return undefined;
  const value = target.closest<HTMLElement>('[data-ocr-result-page]')?.dataset.ocrResultPage;
  return value ? Number(value) : undefined;
}
