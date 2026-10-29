/**
 * 文档解析上传区。
 *
 * 用途：空态对标 mineru-web 上传页——标题、虚线拖放面、限制条目横向排列。
 * 图片使用原图工作台；PDF 按需加载分页预览器，避免增加图片入口的加载成本。
 *
 * 统一处理文件选择、拖放和页面级粘贴。
 */

import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@map/ui';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { lazyWithRetry } from '@/utils/lazyWithRetry';
import type { Attachment } from '../../types';
import { isPdfAttachment } from '../../utils/documentUpload';
import { applyPreparedDocument } from '../../utils/imageGroupPdf';
import type { ImageParseLayoutBlock, ImageParseRotationInfo } from '../../utils/imageParseSample';
import type { ImageParseProgressSnapshot } from '../../utils/imageParseSimulation';
import { ImageParseStage } from './ImageParseStage';
import { ImageParseUploadSurface } from './ImageParseUploadSurface';
import { PdfPreviewLoading } from './PdfPreviewLoading';
import { ImageParsePageRail } from './ImageParsePageRail';

interface ImageParseDropzoneProps {
  attachment?: Attachment;
  disabled?: boolean;
  previewOnly?: boolean;
  onPick: (file: File) => void;
  onClear: () => void;
  onPreview: (src: string) => void;
  /** 该图的版面块；空数组表示不画框，只跑扫描 */
  blocks?: readonly ImageParseLayoutBlock[];
  /** 服务端旋转摆正信息；仅图片工作台直接消费。 */
  rotation?: ImageParseRotationInfo;
  pageBlocks?: Readonly<Record<number, readonly ImageParseLayoutBlock[]>>;
  /** 每一页自己的服务端摆正角度，键是页码。 */
  pageServerAngles?: Readonly<Record<number, number>>;
  progress?: ImageParseProgressSnapshot | null;
  parsing?: boolean;
  showBlocks?: boolean;
  onToggleBlocks?: () => void;
  selectedBlockId?: string;
  hoveredBlockId?: string;
  linkedHighlight?: boolean;
  onHoverBlock?: (id: string | undefined) => void;
  originScrollRef?: (node: HTMLElement | null) => void;
  focusRequest?: number;
  onSelectBlock?: (id: string, page?: number) => void;
  page?: number;
  onPageChange?: (page: number) => void;
  imagePages?: number;
  imagePage?: number;
  onImagePageChange?: (page: number) => void;
  imageAttachments?: readonly Attachment[];
  onAppendPages?: (files: FileList) => void;
  appending?: boolean;
  scrollProgress?: number;
  onScrollProgress?: (progress: number, programmatic?: boolean) => void;
}

const PdfDocumentStage = lazy(() => lazyWithRetry(() => import('./PdfDocumentStage')));

/**
 * 单文档上传与图片、PDF 预览。
 */
export function ImageParseDropzone({
  attachment,
  disabled,
  previewOnly = false,
  onPick,
  onClear,
  onPreview,
  blocks = [],
  rotation,
  pageBlocks,
  pageServerAngles,
  progress = null,
  parsing = false,
  showBlocks = false,
  onToggleBlocks,
  selectedBlockId,
  hoveredBlockId,
  linkedHighlight,
  onHoverBlock,
  originScrollRef,
  focusRequest,
  onSelectBlock,
  page,
  onPageChange,
  imagePages,
  imagePage,
  onImagePageChange,
  imageAttachments,
  onAppendPages,
  appending,
  scrollProgress,
  onScrollProgress,
}: ImageParseDropzoneProps) {
  const { t } = useTranslation('playground');
  const { toast } = useToast();
  const [dragging, setDragging] = useState(false);
  const previewSrc = attachment?.dataUrl || attachment?.proxyUrl || attachment?.url || '';

  const takeFile = useCallback(
    (files: FileList | File[] | null) => {
      if (disabled || !files?.length) return;
      applyPreparedDocument(files, onPick, (error) => toast({ title: t(error), variant: 'error' }));
    },
    [disabled, onPick, t, toast],
  );

  // 页面级粘贴：不必先点上传区，从剪贴板直接放入更符合阅读工具习惯。
  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      if (disabled) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, [contenteditable="true"]')
      ) {
        return;
      }
      const files = event.clipboardData?.files;
      if (!files?.length) return;
      event.preventDefault();
      takeFile(files);
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [disabled, takeFile]);

  return (
    <>
      {attachment && isPdfAttachment(attachment) ? (
        <ErrorBoundary key={attachment.id}>
          <Suspense fallback={<PdfPreviewLoading className="flex-1 bg-muted/30" />}>
            <PdfDocumentStage
              key={attachment.id}
              attachment={attachment}
              disabled={disabled}
              onClear={onClear}
              page={page}
              onPageChange={onPageChange}
              onAppendPages={onAppendPages}
              appending={appending}
              parsing={parsing}
              blocks={blocks}
              pageBlocks={pageBlocks}
              pageServerAngles={pageServerAngles}
              showBlocks={showBlocks}
              onToggleBlocks={onToggleBlocks}
              selectedBlockId={selectedBlockId}
              hoveredBlockId={hoveredBlockId}
              linkedHighlight={linkedHighlight}
              onHoverBlock={onHoverBlock}
              originScrollRef={originScrollRef}
              focusRequest={focusRequest}
              onSelectBlock={onSelectBlock}
              scrollProgress={scrollProgress}
              onScrollProgress={onScrollProgress}
            />
          </Suspense>
        </ErrorBoundary>
      ) : null}
      {attachment && !isPdfAttachment(attachment) ? (
        <ImageParseStage
          attachment={attachment}
          previewSrc={previewSrc}
          disabled={disabled}
          onPreview={onPreview}
          onClear={onClear}
          pages={imagePages}
          page={imagePage}
          onPageChange={onImagePageChange}
          pageNavigation={
            onAppendPages || imageAttachments?.length ? (
              <ImageParsePageRail
                pages={(imageAttachments ?? [attachment]).map((item, index) => ({
                  pageNumber: index + 1,
                  preview: (
                    <img src={item.dataUrl || item.proxyUrl || item.url} alt="" draggable={false} />
                  ),
                }))}
                page={imagePage ?? 1}
                onPageChange={onImagePageChange}
                onAppendPages={onAppendPages}
                disabled={disabled || parsing}
                appending={appending}
              />
            ) : undefined
          }
          blocks={blocks}
          rotation={rotation}
          progress={progress}
          parsing={parsing}
          showBlocks={showBlocks}
          onToggleBlocks={onToggleBlocks}
          selectedBlockId={selectedBlockId}
          hoveredBlockId={hoveredBlockId}
          linkedHighlight={linkedHighlight}
          onHoverBlock={onHoverBlock}
          originScrollRef={originScrollRef}
          focusRequest={focusRequest}
          onSelectBlock={onSelectBlock}
          scrollProgress={scrollProgress}
          onScrollProgress={onScrollProgress}
        />
      ) : null}
      {!attachment ? (
        <EmptyDropzone
          disabled={disabled}
          previewOnly={previewOnly}
          dragging={dragging}
          onOpen={() => undefined}
          onFiles={(files) => takeFile(files)}
          onDragOver={(event) => {
            if (!Array.from(event.dataTransfer.types).includes('Files')) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            if (!Array.from(event.dataTransfer.types).includes('Files')) return;
            event.preventDefault();
            event.stopPropagation();
            setDragging(false);
            takeFile(event.dataTransfer.files);
          }}
        />
      ) : null}
    </>
  );
}

interface EmptyDropzoneProps {
  disabled?: boolean;
  previewOnly: boolean;
  dragging: boolean;
  onOpen: () => void;
  onFiles: (files: FileList) => void;
  onDragOver: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: React.DragEvent<HTMLButtonElement>) => void;
}

/** 空态：mineru 式上传页，限制说明拆成三条，避免一句提示堆在拖放面上。 */
function EmptyDropzone({
  disabled,
  previewOnly,
  dragging,
  onOpen,
  onFiles,
  onDragOver,
  onDragLeave,
  onDrop,
}: EmptyDropzoneProps) {
  const { t } = useTranslation('playground');
  return (
    <div className="flex h-full min-h-0 justify-center overflow-auto bg-muted/20 px-5 py-10 animate-[map-fade-in_0.3s_ease] motion-reduce:animate-none sm:px-8 sm:py-14">
      <div className="flex w-full max-w-4xl flex-col gap-10">
        <div className="flex w-full flex-col gap-6">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium tracking-[0.18em] text-primary">{t('imageParse')}</p>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[30px]">
              {t('imageParseUploadTitle')}
            </h1>
            <p className="max-w-xl text-sm leading-6 text-muted-foreground">
              {t('imageParseUploadSubtitle')}
            </p>
          </div>
          <ImageParseUploadSurface
            disabled={disabled}
            previewOnly={previewOnly}
            dragging={dragging}
            onOpen={onOpen}
            onFiles={onFiles}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          />
        </div>
      </div>
    </div>
  );
}
