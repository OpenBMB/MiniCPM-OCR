import { useTranslation } from 'react-i18next';
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  RotateCcw,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { cn } from '@map/ui';

import type { ImageZoom } from '../../hooks/useImageZoom';
import { MAX_SCALE, MIN_SCALE } from '../../utils/imageZoom';
import { ImageParseToolButton } from './ImageParseToolButton';

interface ImageParseStageToolbarProps {
  zoom: ImageZoom;
  onFullscreen: () => void;
  className?: string;
  pages?: number;
  page?: number;
  onPageChange?: (page: number) => void;
}

/**
 * Tool group at the head of the original image: zoom and orientation actions are grouped, consistent with the PDF original-image toolbar.
 */
export function ImageParseStageToolbar({
  zoom,
  onFullscreen,
  pages,
  page,
  onPageChange,
  className,
}: ImageParseStageToolbarProps) {
  const { t } = useTranslation('playground');
  return (
    <div
      role="toolbar"
      aria-label={t('imageParseOriginal')}
      data-origin-actions=""
      className={cn('flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1', className)}
    >
      {pages && pages > 1 && page && onPageChange ? (
        <div
          className="flex shrink-0 items-center gap-0.5"
          aria-label={t('imageParsePageNavigation')}
        >
          <ImageParseToolButton
            label={t('documentPreviousPage')}
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </ImageParseToolButton>
          <span className="min-w-12 px-1 text-center text-xs tabular-nums text-muted-foreground">
            {page} / {pages}
          </span>
          <ImageParseToolButton
            label={t('documentNextPage')}
            onClick={() => onPageChange(page + 1)}
            disabled={page >= pages}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </ImageParseToolButton>
        </div>
      ) : null}
      <div className="flex shrink-0 items-center">
        <ImageParseToolButton
          label={t('imageParseZoomOut')}
          onClick={zoom.zoomOut}
          disabled={zoom.scale <= MIN_SCALE}
        >
          <ZoomOut className="size-4" aria-hidden="true" />
        </ImageParseToolButton>
        <span
          aria-live="polite"
          title={t('imageParseZoomHint')}
          className="w-12 shrink-0 text-center text-xs tabular-nums text-muted-foreground"
        >
          {Math.round(zoom.scale * 100)}%
        </span>
        <ImageParseToolButton
          label={t('imageParseZoomIn')}
          onClick={zoom.zoomIn}
          disabled={zoom.scale >= MAX_SCALE}
        >
          <ZoomIn className="size-4" aria-hidden="true" />
        </ImageParseToolButton>
      </div>
      <div className="flex shrink-0 items-center">
        <ImageParseToolButton label={t('imageParseRotateLeft')} onClick={() => zoom.rotate(-1)}>
          <RotateCcw className="size-4" aria-hidden="true" />
        </ImageParseToolButton>
        <ImageParseToolButton label={t('imageParseRotateRight')} onClick={() => zoom.rotate(1)}>
          <RotateCw className="size-4" aria-hidden="true" />
        </ImageParseToolButton>
        <ImageParseToolButton label={t('imagePreview')} onClick={onFullscreen}>
          <Maximize2 className="size-4" aria-hidden="true" />
        </ImageParseToolButton>
      </div>
    </div>
  );
}
