/**
 * Image-parse original-image column (the workspace once there is an image).
 *
 * Purpose: checking an OCR result has to get close enough to read small type, seals, and handwriting, so this column is a real viewer — wheel scrolls vertically by default, Ctrl/Meta wheel zooms anchored at the cursor, pan is constrained, plus rotate, reset, and fullscreen. View controls stay visible: zoom and rotation are the main actions while checking, and making them appear only on hover is the same as not having them.
 *
 * While parsing, a scan and layout boxes are stacked on the image, so the image frame size has to be exact — the wrapper uses the image's real aspect ratio to fill the viewport width, a long document shows the top first, and the overlay's inset-0 shares a coordinate system with the original. The original is drawn at the target size and the overlay uses the same coordinate system; box strokes and numbers stay a fixed size.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, cn } from '@map/ui';
import { useImageZoom, type ImageZoom } from '../../hooks/useImageZoom';
import type { Attachment } from '../../types';
import type { ImageParseLayoutBlock, ImageParseRotationInfo } from '../../utils/imageParseSample';
import type { ImageParseProgressSnapshot } from '../../utils/imageParseSimulation';
import { imageParseBlockId } from '../../utils/imageParseBlocks';
import { WORKSPACE_TOOLBAR } from '../../utils/imageParseWorkspaceStyles';
import { ImageParseScanOverlay } from './ImageParseScanOverlay';
import { ImageParseBlocksOverlay } from './ImageParseBlocksOverlay';
import { ImageParseStageToolbar } from './ImageParseStageToolbar';

interface ImageParseStageProps {
  attachment: Attachment;
  /** Displayable address already resolved */
  previewSrc: string;
  disabled?: boolean;
  onPreview: (src: string) => void;
  onClear: () => void;
  blocks: readonly ImageParseLayoutBlock[];
  /** Server rotation-adaptation info; bbox/regions coordinates are already based on the image after rotation adaptation. */
  rotation?: ImageParseRotationInfo;
  progress: ImageParseProgressSnapshot | null;
  parsing: boolean;
  showBlocks?: boolean;
  onToggleBlocks?: () => void;
  selectedBlockId?: string;
  hoveredBlockId?: string;
  linkedHighlight?: boolean;
  onHoverBlock?: (id: string | undefined) => void;
  originScrollRef?: (node: HTMLElement | null) => void;
  focusRequest?: number;
  onSelectBlock?: (id: string) => void;
  pages?: number;
  page?: number;
  onPageChange?: (page: number) => void;
  pageNavigation?: ReactNode;
  scrollProgress?: number;
  onScrollProgress?: (progress: number, programmatic?: boolean) => void;
}

/**
 * Original-image viewer.
 * @param attachment Current image attachment
 * @param previewSrc Image address
 * @param onPreview Open the fullscreen preview
 * @param blocks Layout blocks; an empty array means draw no boxes
 * @param progress Parse progress snapshot
 * @param parsing Whether parsing is in progress
 */
export function ImageParseStage({
  attachment,
  previewSrc,
  onPreview,
  blocks,
  rotation,
  progress,
  parsing,
  showBlocks,
  onToggleBlocks: _onToggleBlocks,
  selectedBlockId,
  hoveredBlockId,
  linkedHighlight,
  onHoverBlock,
  originScrollRef,
  focusRequest,
  onSelectBlock,
  pages,
  page,
  onPageChange,
  pageNavigation,
  scrollProgress,
  onScrollProgress,
}: ImageParseStageProps) {
  const { t } = useTranslation('playground');
  // Save the original image size; after server rotation adaptation the wrapper is sized to the rotated bounding box.
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const zoom = useImageZoom({ fitWidth: true });
  const lastFocus = useRef<{ src: string; request: number } | null>(null);
  const pendingProgress = useRef<
    { progress: number; source: 'scroll' | 'focus'; src: string } | undefined
  >(undefined);
  const reportedProgress = useRef<number | undefined>(undefined);
  const viewportRef = useRef<HTMLElement | null>(null);
  const serverRotation =
    rotation?.enabled && rotation.applied && Number.isFinite(rotation.totalAngle)
      ? rotation.totalAngle
      : 0;
  const rotatedLayout = useMemo(() => {
    if (!naturalSize) return null;
    if (!serverRotation) return { width: naturalSize.width, height: naturalSize.height };
    const radians = (Math.abs(serverRotation) * Math.PI) / 180;
    return {
      width:
        naturalSize.width * Math.abs(Math.cos(radians)) +
        naturalSize.height * Math.abs(Math.sin(radians)),
      height:
        naturalSize.width * Math.abs(Math.sin(radians)) +
        naturalSize.height * Math.abs(Math.cos(radians)),
    };
  }, [naturalSize, serverRotation]);
  const ratio = rotatedLayout ? rotatedLayout.width / rotatedLayout.height : null;
  const imageWidthPercent =
    naturalSize && rotatedLayout ? (naturalSize.width / rotatedLayout.width) * 100 : 100;
  // Destructure the two ref callbacks first: stuffing zoom's properties straight into the ref prop makes lint treat the whole zoom object as the ref.
  const { reset, setViewport, setContent, focusBlock, scrollToProgress } = zoom;
  const attachViewport = useCallback(
    (node: HTMLElement | null) => {
      viewportRef.current = node;
      setViewport(node);
      originScrollRef?.(node);
    },
    [setViewport, originScrollRef],
  );

  // After changing images, return to the initial view, or the new image carries the previous one's scale and angle.
  useEffect(() => {
    reset();
  }, [previewSrc, reset]);

  useLayoutEffect(() => {
    if (pendingProgress.current?.src !== previewSrc) pendingProgress.current = undefined;
    if (scrollProgress === undefined || !Number.isFinite(scrollProgress)) {
      // After an external request is consumed, only end its own confirmation, and do not clear a click location that is still pending confirmation across a fit-width switch.
      if (pendingProgress.current?.source === 'scroll') pendingProgress.current = undefined;
      return;
    }
    const viewport = viewportRef.current;
    const raster = viewport?.querySelector('[data-image-raster]')?.getBoundingClientRect();
    const short = viewport?.clientHeight && raster && raster.height <= viewport.clientHeight;
    pendingProgress.current = {
      progress: short ? 0 : Math.max(0, Math.min(1, scrollProgress)),
      source: 'scroll',
      src: previewSrc,
    };
    scrollToProgress(scrollProgress);
  }, [previewSrc, scrollProgress, scrollToProgress]);

  useEffect(() => {
    if (!zoom.raster.width || !zoom.raster.height) return;
    const actual = zoom.scrollProgress;
    // Confirm the actual position and consume the request; programmatic location only forbids writing back the other way, and must not swallow position confirmation.
    if (pendingProgress.current !== undefined) {
      if (Math.abs(actual - pendingProgress.current.progress) < 0.001) {
        pendingProgress.current = undefined;
        reportedProgress.current = actual;
        onScrollProgress?.(actual, true);
      }
      return;
    }
    if (reportedProgress.current === actual) return;
    reportedProgress.current = actual;
    onScrollProgress?.(actual);
  }, [
    onScrollProgress,
    zoom.raster.height,
    zoom.raster.width,
    zoom.scrollProgress,
    scrollProgress,
    focusRequest,
  ]);

  useLayoutEffect(() => {
    if (!focusRequest || !selectedBlockId) return;
    if (lastFocus.current?.src === previewSrc && lastFocus.current.request === focusRequest) return;
    const block = blocks.find((item, index) => imageParseBlockId(item, index) === selectedBlockId);
    const target = block ? (block.regions?.[0] ?? block) : undefined;
    if (
      target &&
      focusBlock(target, (progress) => {
        pendingProgress.current = { progress, source: 'focus', src: previewSrc };
      })
    )
      lastFocus.current = { src: previewSrc, request: focusRequest };
    // A collapsed image column cannot be measured; run unfinished location on the first measurement after it expands again.
  }, [blocks, focusBlock, focusRequest, previewSrc, selectedBlockId]);

  return (
    <div className="group relative flex h-full min-h-48 flex-col overflow-hidden bg-muted/25">
      <div
        data-image-toolbar=""
        className={cn(WORKSPACE_TOOLBAR, 'gap-x-3 py-1 text-xs font-medium text-muted-foreground')}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="shrink-0">{t('imageParseOriginal')}</span>
          {serverRotation ? (
            <Badge
              variant="secondary"
              data-image-rotation-badge=""
              title={t('imageParseRotationAppliedTitle')}
              className="px-2 py-0 text-[10px] font-medium"
            >
              {t('imageParseRotationApplied', { angle: Math.round(serverRotation) })}
            </Badge>
          ) : null}
          {blocks.some((block) => block.kind === 'footer') ? (
            <Badge
              variant="secondary"
              data-image-footer-badge=""
              title={t('imageParseFooterDetectedTitle')}
              className="px-2 py-0 text-[10px] font-medium"
            >
              {t('imageParseFooterDetected')}
            </Badge>
          ) : null}
        </div>
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-0.5">
          <ImageParseStageToolbar
            zoom={zoom}
            onFullscreen={() => previewSrc && onPreview(previewSrc)}
            pages={pages}
            page={page}
            onPageChange={onPageChange}
          />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {pageNavigation}
        <div className="flex min-h-0 min-w-0 flex-1 p-3">
          <div
            ref={attachViewport}
            data-image-viewport=""
            data-image-rotation={zoom.rotation}
            data-image-progress={zoom.scrollProgress}
            onDoubleClick={zoom.onDoubleClick}
            onPointerDown={zoom.onPointerDown}
            onPointerMove={zoom.onPointerMove}
            onPointerUp={zoom.onPointerUp}
            onPointerCancel={zoom.onPointerUp}
            className={cn(
              // touch-none: on a touch screen, pointermove has to be received before panning works, or it is swallowed as page scrolling
              'flex h-full min-h-0 w-full touch-none items-center justify-center overflow-hidden',
              stageCursor(zoom),
            )}
          >
            <span
              ref={setContent}
              style={{ aspectRatio: ratio ? String(ratio) : undefined }}
              // min-h-0: after server rotation adaptation of 90/270 degrees the aspect ratio is the opposite of the original, and aspect-ratio's default
              // min-height:auto is stretched by the measurement image laid out at the original ratio, and the box layer is stretched vertically with it.
              className="relative flex min-h-0 w-full shrink-0 items-center justify-center"
            >
              {/* Used only to measure the original image size; once the ratio is known it leaves document flow, and the container height is decided only by the ratio after rotation adaptation. */}
              <img
                src={previewSrc}
                alt=""
                aria-hidden="true"
                draggable={false}
                onLoad={(event) => {
                  const { naturalWidth, naturalHeight } = event.currentTarget;
                  if (naturalWidth > 0 && naturalHeight > 0)
                    setNaturalSize({ width: naturalWidth, height: naturalHeight });
                }}
                className={cn(
                  'invisible h-auto w-full select-none',
                  ratio && 'absolute left-0 top-0',
                )}
              />
              <span
                data-image-raster=""
                data-image-server-rotation={serverRotation ? String(serverRotation) : undefined}
                style={{
                  width: zoom.raster.width || '100%',
                  height: zoom.raster.height || '100%',
                  transform: `translate(-50%, -50%) ${zoom.raster.transform}`,
                }}
                // Boundary correction takes effect immediately, so a translation transition after resize does not briefly show blank space outside the image.
                className="absolute left-1/2 top-1/2"
              >
                <span className="absolute inset-0 flex items-center justify-center overflow-visible">
                  <img
                    src={previewSrc}
                    alt={attachment.name}
                    draggable={false}
                    style={{
                      width: `${imageWidthPercent}%`,
                      transform: `rotate(${-serverRotation}deg)`,
                    }}
                    className="block h-auto max-w-none select-none"
                  />
                </span>
                <ImageParseScanOverlay
                  blocks={showBlocks ? [] : blocks}
                  progress={progress}
                  active={parsing}
                  maskSrc={previewSrc}
                />
                {showBlocks && onSelectBlock ? (
                  <ImageParseBlocksOverlay
                    blocks={blocks}
                    selectedBlockId={selectedBlockId}
                    hoveredBlockId={hoveredBlockId}
                    linkedHighlight={linkedHighlight}
                    onHoverBlock={onHoverBlock}
                    onSelect={onSelectBlock}
                  />
                ) : null}
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Viewport cursor: the document can be dragged inside the bounds, and pressing switches to the grabbing state. */
function stageCursor(zoom: ImageZoom): string {
  return zoom.dragging ? 'cursor-grabbing' : 'cursor-grab';
}
