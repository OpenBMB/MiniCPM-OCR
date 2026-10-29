import { memo, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Button, Empty, Progress } from '@map/ui';

import type { ImageParseDraft } from '../../hooks/useImageParseDraft';
import { useImageParseHighlight } from '../../hooks/useImageParseHighlight';
import type { PdfPageResult } from '../../utils/pdfImageParse';
import { imageParseBlockId, imageParseBlockRanges } from '../../utils/imageParseBlocks';
import { imageParsePageNumberRanges } from '../../utils/imageParsePageNumber';
import type { useImageParseRegeneration } from '../../hooks/useImageParseRegeneration';
import { MarkdownRenderer } from '../MarkdownRenderer';
import { ImageParseVisualEditor } from './ImageParseVisualEditor';
import { ImageParsePreviewReview } from './ImageParsePreviewReview';
import {
  imageParseSealDisplayCrops,
  imageParseSealDisplayResult,
} from '../../utils/imageParseSealDisplay';

interface ImageParsePdfResultPageProps {
  page: number;
  resultKey: string;
  result?: PdfPageResult;
  completed: number;
  total: number;
  draft: ImageParseDraft;
  current: boolean;
  loading: boolean;
  tab: string;
  linked: boolean;
  selectedId?: string;
  hoveredId?: string;
  focusRequest?: number;
  regeneration?: ReturnType<typeof useImageParseRegeneration>;
  recognizeSeal: boolean;
  recognizeChart: boolean;
  onCopyRegion?: (id: string) => void;
  onFocus?: (top: number) => void;
  onRetry: (page: number) => void;
  onEditingChange: (page: number, value: boolean) => void;
}

/** Highlight and edit for a single-page result stay strictly on this page, so a duplicate id across pages is not hit. */
export const ImageParsePdfResultPage = memo(function ImageParsePdfResultPage({
  page,
  resultKey,
  result,
  completed = 0,
  total = 0,
  draft,
  current,
  loading,
  tab,
  linked,
  selectedId,
  hoveredId,
  focusRequest,
  regeneration,
  recognizeSeal,
  recognizeChart,
  onCopyRegion,
  onFocus,
  onRetry,
  onEditingChange,
}: ImageParsePdfResultPageProps) {
  const { t } = useTranslation('playground');
  const root = useRef<HTMLDivElement>(null);
  const markdown = result?.result?.markdown ?? '';
  const baseRanges = useMemo(
    () => imageParseBlockRanges(markdown, result?.result?.blocks ?? []),
    [markdown, result?.result?.blocks],
  );
  const pageDraft = draft.forResult?.(markdown, resultKey, baseRanges) ?? draft;
  const display = useMemo(
    () =>
      imageParseSealDisplayResult(
        { markdown: pageDraft.value, blocks: result?.result?.blocks ?? [] },
        recognizeSeal,
        recognizeChart,
        pageDraft.ranges,
      ),
    [pageDraft.ranges, pageDraft.value, recognizeChart, recognizeSeal, result?.result?.blocks],
  );
  const ranges = useMemo(
    () => imageParseBlockRanges(display.markdown, display.blocks),
    [display.blocks, display.markdown],
  );
  const pageNumberRanges = useMemo(
    () => imageParsePageNumberRanges(display.blocks, ranges),
    [display.blocks, ranges],
  );
  const links = useMemo(() => [...ranges].map(([id, range]) => ({ id, range })), [ranges]);
  const selected = current ? selectedId : undefined;
  const selectedBlockKind = selected
    ? display.blocks.find((item, index) => imageParseBlockId(item, index) === selected)?.kind
    : undefined;
  const pagePending = !result?.result && !result?.error;
  const emptyState = (() => {
    if (pagePending)
      return (
        <ImageParsePdfPendingPage
          page={page}
          completed={completed}
          total={total}
          current={current}
          loading={loading}
          onRetry={onRetry}
        />
      );
    if (result?.error)
      return (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 py-4 text-sm text-destructive"
        >
          <span>{t(result.error)}</span>
          <Button size="sm" variant="outline" disabled={loading} onClick={() => onRetry(page)}>
            {t('documentPdfRetryPage')}
          </Button>
        </div>
      );
    return <Empty title={t('imageParseEmpty')} />;
  })();
  const editingChanged = useCallback(
    (value: boolean) => onEditingChange(page, value),
    [page, onEditingChange],
  );
  useImageParseHighlight(
    root,
    selected,
    current ? focusRequest : undefined,
    display.markdown,
    links,
    tab,
    selected ? ranges.get(selected) : undefined,
    linked,
    current && linked ? hoveredId : undefined,
    onFocus,
  );
  return (
    <div ref={root} className="relative">
      {display.markdown ? (
        <ImageParseVisualEditor
          source={display.markdown}
          loading={pagePending}
          pageNumberRanges={pageNumberRanges}
          onSave={pageDraft.setValue}
          onEditingChange={editingChanged}
        >
          <MarkdownRenderer
            content={display.markdown}
            variant="document"
            editableBlocks={Boolean(ranges.size || recognizeSeal || recognizeChart)}
            imageCrops={
              pageDraft.dirty
                ? []
                : imageParseSealDisplayCrops(
                    result?.result?.blocks ?? [],
                    result?.crops ?? [],
                    recognizeSeal,
                    recognizeChart,
                  )
            }
            streaming={pagePending}
            linkedRanges={links}
          />
        </ImageParseVisualEditor>
      ) : (
        <div className="min-h-48">{emptyState}</div>
      )}
      {current ? (
        <ImageParsePreviewReview
          root={root}
          selectedId={selected}
          blockKind={selectedBlockKind}
          content={display.markdown}
          visible={!pagePending && tab === 'preview'}
          ranges={ranges}
          regeneration={regeneration}
          onCopyRegion={onCopyRegion}
        />
      ) : null}
    </div>
  );
});

interface ImageParsePdfPendingPageProps {
  page: number;
  completed: number;
  total: number;
  current: boolean;
  loading: boolean;
  onRetry: (page: number) => void;
}

/** An unfinished page keeps only a page-number anchor; only the current page shows the loading state and overall progress. */
export function ImageParsePdfPendingPage({
  page,
  completed,
  total,
  current,
  loading,
  onRetry,
}: ImageParsePdfPendingPageProps) {
  const { t } = useTranslation('playground');
  if (loading && !current) {
    return (
      <div className="flex items-center justify-center border-t border-border/40 px-4 py-5">
        <p className="text-xs font-medium text-muted-foreground/50">
          {t('documentPdfCurrentPage', { page })}
        </p>
      </div>
    );
  }
  const pendingTitle = loading ? 'documentPdfCurrentPage' : 'documentPdfPagePendingTitle';
  const pendingDescription = loading ? 'documentPdfProgress' : 'documentPdfPagePendingDescription';
  const icon =
    loading && current ? (
      <Loader2
        className="size-8 animate-spin text-primary motion-reduce:animate-none"
        aria-hidden="true"
      />
    ) : undefined;
  return (
    <div
      role="status"
      className="flex min-h-72 flex-col items-center justify-center gap-4 px-4 py-10"
    >
      <Empty
        className="py-0"
        icon={icon}
        title={t(pendingTitle, { page })}
        description={t(pendingDescription, { completed, total })}
      />
      {loading ? (
        <Progress
          className="w-full max-w-64"
          value={total ? (completed / total) * 100 : 0}
          aria-label={t('documentPdfProgress', { completed, total })}
        />
      ) : (
        <Button size="sm" variant="outline" onClick={() => onRetry(page)}>
          {t('documentPdfRetryPage')}
        </Button>
      )}
    </div>
  );
}
