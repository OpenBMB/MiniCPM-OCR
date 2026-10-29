/** 图像解析结果栏：切视图时保持正文挂载，避免重复解析。 */

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

/** 面板切换保持挂载；不要在每次展开时从透明度 0 重播入场动画。 */
const TAB_CONTENT_CLASS = 'mt-0 min-h-0 flex-1 overflow-auto bg-card data-[state=inactive]:hidden';

/** 三页共用的内容留白。底部多留一截，滚到末尾时最后一行不会贴着栏底。 */
const PAGE_PADDING = 'px-4 pb-12 pt-4 sm:px-6';

/** 内容列限宽居中，避免全宽模式下行长影响阅读。 */
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
  /** 复制当前选中区域；表格由上层按 HTML + TSV 处理 */
  onCopyRegion?: (id: string) => void;
  selectedBlockId?: string;
  hoveredBlockId?: string;
  onHoverBlock?: (id: string | undefined, page?: number) => void;
  focusRequest?: number;
  selectedRange?: ImageParseTextRange;
  linkedRanges?: readonly ImageParseLinkedRange[];
  tab?: string;
  /** 临时开关：是否展示待复核页。 */
  reviewEnabled?: boolean;
  onTabChange?: (tab: string) => void;
  onSelectBlock?: (id: string, page?: number) => void;
  linked?: boolean;
  onToggleLinked?: () => void;
  showBlocks?: boolean;
  onToggleBlocks?: () => void;
  /** 多页示例的跨页表格合并；PDF 多页时用 parse.pdf.tableMerge。 */
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
 * Markdown 结果栏。
 * @param parse 图像解析编排状态
 * @param draft 可编辑草稿
 * @param onCopyRegion 复制当前选中区域
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
  // 页数说明原文已打开；未完成页保留占位，避免用户误以为结果栏无响应。
  const continuousPdf = Boolean(parse.pdf?.pages);
  // 印章识别允许空正文；只要返回了真实区块，也应展示结果而不是空态。
  const hasPreview = Boolean(shownMarkdown || continuousPdf || shownLayout.length > 0);
  const hasStableResult = !loading && (parse.finished || Boolean(parse.pdf?.completed));
  const [localTab, setLocalTab] = useState('preview');
  const requestedTab = tab ?? localTab;
  // 待复核能力临时隐藏；外部恢复旧视图时回落到预览，避免停留在不可见内容。
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
  // 成功复核即完成待办，不要求提分；失败仍保留待办，分数与对比列表不受影响。
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
        {/* KIE 成功解析后只展示结果表，避免同一份 JSON 再以正文重复渲染。 */}
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

  // 切标签时保留正文挂载和纯色背景，避免内容先透明再出现。
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
            {/* 正文与顶栏同底色，只靠限宽和留白成版，不再套卡片吃掉边距 */}
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

/** 文档节点上的直接定位入口；链接和表单控件沿用自身交互。 */
function linkedBlockId(target: EventTarget | null): string | undefined {
  if (!(target instanceof HTMLElement) || target.closest('a, button, input, textarea, select')) {
    return undefined;
  }
  return target.closest<HTMLElement>('[data-ocr-block-id]')?.dataset.ocrBlockId;
}

/** 点击的结果页提供页级定位上下文；图片预览保持原有单参数事件。 */
function linkedPage(target: EventTarget | null): number | undefined {
  if (!(target instanceof HTMLElement)) return undefined;
  const value = target.closest<HTMLElement>('[data-ocr-result-page]')?.dataset.ocrResultPage;
  return value ? Number(value) : undefined;
}
