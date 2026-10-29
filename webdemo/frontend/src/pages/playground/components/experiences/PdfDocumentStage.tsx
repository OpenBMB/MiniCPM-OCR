import { useCallback, useEffect, useRef, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Input, cn } from '@map/ui';
import type { Attachment } from '../../types';
import { usePdfPreview } from '../../hooks/usePdfPreview';
import type { ImageParseLayoutBlock } from '../../utils/imageParseSample';
import { WORKSPACE_CONTROL, WORKSPACE_TOOLBAR } from '../../utils/imageParseWorkspaceStyles';
import { PdfDocumentPage } from './PdfDocumentPage';
import { ImageParseToolButton } from './ImageParseToolButton';
import { PdfPreviewLoading } from './PdfPreviewLoading';
import { ImageParsePageRail } from './ImageParsePageRail';
import { PdfPageThumbnail } from './PdfPageThumbnail';

interface PdfDocumentStageProps {
  attachment: Attachment;
  disabled?: boolean;
  onClear: () => void;
  page?: number;
  onPageChange?: (page: number) => void;
  onAppendPages?: (files: FileList) => void;
  appending?: boolean;
  parsing?: boolean;
  blocks?: readonly ImageParseLayoutBlock[];
  pageBlocks?: Readonly<Record<number, readonly ImageParseLayoutBlock[]>>;
  /** 每一页自己的服务端摆正角度，键是页码。 */
  pageServerAngles?: Readonly<Record<number, number>>;
  showBlocks?: boolean;
  onToggleBlocks?: () => void;
  selectedBlockId?: string;
  hoveredBlockId?: string;
  linkedHighlight?: boolean;
  onHoverBlock?: (id: string | undefined) => void;
  originScrollRef?: (node: HTMLElement | null) => void;
  focusRequest?: number;
  onSelectBlock?: (id: string, page?: number) => void;
  scrollProgress?: number;
  onScrollProgress?: (progress: number, programmatic?: boolean) => void;
}

const NO_BLOCKS: readonly ImageParseLayoutBlock[] = [];

/** PDF 原文阅读器：所有页面在同一视口连续滚动，页码只负责定位。 */
export default function PdfDocumentStage({
  attachment,
  disabled,
  page,
  onPageChange,
  onAppendPages,
  appending,
  parsing,
  blocks = [],
  pageBlocks,
  pageServerAngles,
  showBlocks,
  onToggleBlocks: _onToggleBlocks,
  selectedBlockId,
  hoveredBlockId,
  linkedHighlight,
  onHoverBlock,
  originScrollRef,
  focusRequest,
  onSelectBlock,
  scrollProgress,
  onScrollProgress,
}: PdfDocumentStageProps) {
  const { t } = useTranslation('playground');
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pendingScroll = useRef<number | undefined>(undefined);
  const lastFocus = useRef<string | undefined>(undefined);
  const {
    setViewport,
    setPageNode,
    setPageCanvas,
    onViewportScroll: updateCurrentPage,
    activatePage,
    ...pdf
  } = usePdfPreview(
    attachment.dataUrl || attachment.publicUrl || attachment.url || '',
    page,
    onPageChange,
    false,
  );
  const selectPageBlock = useCallback(
    (id: string, pageNumber: number) => {
      if (pageNumber === pdf.page) onSelectBlock?.(id);
      else {
        activatePage(pageNumber);
        onSelectBlock?.(id, pageNumber);
      }
    },
    [activatePage, onSelectBlock, pdf.page],
  );
  const setViewportRef = useCallback(
    (node: HTMLDivElement | null) => {
      viewportRef.current = node;
      setViewport(node);
      originScrollRef?.(node);
    },
    [setViewport, originScrollRef],
  );
  const goToPage = useCallback(
    (next: number) => {
      pdf.goTo(next);
      const viewport = viewportRef.current;
      if (viewport) pendingScroll.current = viewport.scrollTop;
    },
    [pdf],
  );
  const controls = [
    { label: 'imageParseZoomOut', icon: ZoomOut, action: pdf.zoomOut, disabled: pdf.scale <= 0.5 },
    { label: 'imageParseZoomIn', icon: ZoomIn, action: pdf.zoomIn, disabled: pdf.scale >= 3 },
    { label: 'imageParseRotateRight', icon: RotateCw, action: pdf.rotate },
  ];
  // 首帧提交前使用固定视口占位，不随页面尺寸或连续文档的滚动位置重新居中。
  const initialLoading = pdf.rendering && !pdf.readyPageNumbers.length && !pdf.error;
  const focusPreviewBlock = useCallback(
    (id: string) => {
      const viewport = viewportRef.current;
      const block = Array.from(
        viewport?.querySelectorAll<HTMLElement>(
          `[data-pdf-page="${pdf.page}"] [data-origin-block-id]`,
        ) ?? [],
      ).find((node) => node.dataset.originBlockId === id);
      if (!viewport || !block) return false;
      const bounds = viewport.getBoundingClientRect();
      const target = block.getBoundingClientRect();
      // 不用 scrollIntoView，避免滚动链同时移动工作台外层页面。
      viewport.scrollTop = Math.max(
        0,
        Math.min(
          viewport.scrollHeight - viewport.clientHeight,
          viewport.scrollTop +
            target.top -
            bounds.top +
            target.height / 2 -
            viewport.clientHeight / 2,
        ),
      );
      viewport.scrollLeft = Math.max(
        0,
        Math.min(
          viewport.scrollWidth - viewport.clientWidth,
          viewport.scrollLeft +
            target.left -
            bounds.left +
            target.width / 2 -
            viewport.clientWidth / 2,
        ),
      );
      pendingScroll.current = viewport.scrollTop;
      const range = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      onScrollProgress?.(range ? viewport.scrollTop / range : 0, true);
      return true;
    },
    [onScrollProgress, pdf.page],
  );

  useEffect(() => {
    if (!focusRequest || !selectedBlockId || pdf.rendering) return;
    const key = `${attachment.id}:${pdf.page}:${selectedBlockId}:${focusRequest}`;
    if (lastFocus.current === key) return;
    if (focusPreviewBlock(selectedBlockId)) lastFocus.current = key;
  }, [
    attachment.id,
    focusRequest,
    selectedBlockId,
    pdf.page,
    pdf.rendering,
    showBlocks,
    focusPreviewBlock,
  ]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (
      !viewport ||
      pdf.rendering ||
      scrollProgress === undefined ||
      !Number.isFinite(scrollProgress)
    )
      return;
    const next =
      Math.max(0, viewport.scrollHeight - viewport.clientHeight) *
      Math.max(0, Math.min(1, scrollProgress));
    viewport.scrollTop = next;
    pendingScroll.current = viewport.scrollTop;
    const range = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    onScrollProgress?.(range ? viewport.scrollTop / range : 0, true);
  }, [pdf.rendering, scrollProgress, onScrollProgress]);

  const onViewportScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const viewport = event.currentTarget;
      const expected = pendingScroll.current;
      pendingScroll.current = undefined;
      const range = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      const progress = range ? Math.max(0, Math.min(1, viewport.scrollTop / range)) : 0;
      if (expected !== undefined && Math.abs(expected - viewport.scrollTop) < 1)
        onScrollProgress?.(progress, true);
      else {
        // 联动和块定位只调整当前页视口，不能再次用视口中心反向改写所选页。
        updateCurrentPage();
        onScrollProgress?.(progress);
      }
    },
    [updateCurrentPage, onScrollProgress],
  );

  return (
    <section
      className="flex h-full min-h-48 min-w-0 flex-col bg-muted/30"
      aria-label={t('documentPdfPreview')}
    >
      <div data-pdf-toolbar="" className={cn(WORKSPACE_TOOLBAR, 'justify-between gap-x-3 py-1')}>
        <div className="flex shrink-0 items-center gap-1">
          <ImageParseToolButton
            label={t('documentPreviousPage')}
            onClick={() => goToPage(pdf.page - 1)}
            disabled={pdf.page <= 1}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </ImageParseToolButton>
          <Input
            key={`${attachment.id}-${pdf.page}`}
            type="number"
            min={1}
            max={pdf.pages || 1}
            defaultValue={pdf.page}
            disabled={!pdf.pages}
            aria-label={t('documentPageNumber')}
            className={cn(
              WORKSPACE_CONTROL,
              'w-11 shrink-0 px-1 text-center tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
            )}
            onBlur={(event) => {
              goToPage(Number(event.target.value));
              event.target.value = String(pdf.page);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
          <span
            className="min-w-8 whitespace-nowrap px-1 text-xs tabular-nums text-muted-foreground"
            aria-live="polite"
          >
            / {pdf.pages || '—'}
          </span>
          <ImageParseToolButton
            label={t('documentNextPage')}
            onClick={() => goToPage(pdf.page + 1)}
            disabled={!pdf.pages || pdf.page >= pdf.pages}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </ImageParseToolButton>
        </div>
        <div className="flex flex-wrap items-center gap-0.5">
          {controls.map(({ label, icon: Icon, action, disabled: blocked }) => (
            <ImageParseToolButton
              key={label}
              label={t(label)}
              onClick={action}
              disabled={!pdf.pages || blocked}
            >
              <Icon className="size-4" aria-hidden="true" />
            </ImageParseToolButton>
          ))}
          <span className="min-w-11 px-1 text-center text-xs tabular-nums text-muted-foreground">
            {Math.round(pdf.scale * 100)}%
          </span>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {onAppendPages || pdf.pages > 1 ? (
          <ImageParsePageRail
            pages={pdf.pageList.map(({ pageNumber }) => ({
              pageNumber,
              preview: <PdfPageThumbnail document={pdf.document} pageNumber={pageNumber} />,
            }))}
            page={pdf.page}
            onPageChange={goToPage}
            onAppendPages={onAppendPages}
            disabled={disabled || parsing || !pdf.pages}
            appending={appending}
          />
        ) : null}
        <div className="relative flex min-h-0 min-w-0 flex-1">
          <div
            data-pdf-viewport=""
            data-pdf-current-page={pdf.page}
            data-pdf-rotation={pdf.displayRotation ?? pdf.rotation}
            aria-busy={pdf.rendering}
            ref={setViewportRef}
            onScroll={onViewportScroll}
            onPointerDown={pdf.onPointerDown}
            onPointerMove={pdf.onPointerMove}
            onPointerUp={pdf.onPointerUp}
            onPointerCancel={pdf.onPointerUp}
            onLostPointerCapture={pdf.onPointerUp}
            className={cn(
              'relative min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain',
              pdf.dragging ? 'cursor-grabbing select-none' : 'cursor-grab',
            )}
            style={
              {
                '--pdf-live-scale': pdf.scale,
                padding: 'calc(1rem * var(--pdf-live-scale))',
              } as CSSProperties
            }
          >
            {pdf.error ? (
              <div
                role="alert"
                className="flex flex-col items-center gap-3 p-4 text-center text-sm text-destructive"
              >
                <p>{t(pdf.error)}</p>
                <Button variant="outline" onClick={pdf.retry}>
                  {t('documentRetryPreview')}
                </Button>
              </div>
            ) : null}
            <div
              className={cn(
                'flex w-max min-w-full flex-col items-center',
                (pdf.error || initialLoading || !pdf.pageList.length) && 'invisible',
              )}
              style={{ gap: 'calc(1rem * var(--pdf-live-scale))' } as CSSProperties}
            >
              {pdf.pageList.map((item) => (
                <PdfDocumentPage
                  key={item.pageNumber}
                  pageNumber={item.pageNumber}
                  width={item.baseWidth}
                  height={item.baseHeight}
                  label={t('documentPageLabel', {
                    name: attachment.name,
                    page: item.pageNumber,
                  })}
                  active={item.pageNumber === pdf.page}
                  renderCanvas={pdf.visiblePageNumbers.includes(item.pageNumber)}
                  ready={pdf.readyPageNumbers.includes(item.pageNumber)}
                  showLoading={!initialLoading && !pdf.error}
                  rotation={pdf.displayRotation ?? pdf.rotation}
                  serverAngle={pageServerAngles?.[item.pageNumber] ?? 0}
                  blocks={
                    item.pageNumber === pdf.page
                      ? blocks
                      : (pageBlocks?.[item.pageNumber] ?? NO_BLOCKS)
                  }
                  showBlocks={showBlocks && !pdf.error}
                  selectedBlockId={selectedBlockId}
                  hoveredBlockId={hoveredBlockId}
                  linkedHighlight={linkedHighlight}
                  onHoverBlock={onHoverBlock}
                  onSelectBlock={onSelectBlock ? selectPageBlock : undefined}
                  setPageNode={setPageNode}
                  setPageCanvas={setPageCanvas}
                />
              ))}
            </div>
          </div>
          {initialLoading ? (
            <PdfPreviewLoading className="pointer-events-none absolute inset-0 z-10 overflow-hidden" />
          ) : null}
        </div>
      </div>
    </section>
  );
}
