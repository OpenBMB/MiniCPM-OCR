import { memo, useCallback, useMemo, type CSSProperties } from 'react';

import { cn } from '@map/ui';

import type { ImageParseLayoutBlock } from '../../utils/imageParseSample';
import { rotatedPageBounds, rotateImageParseBlocks } from '../../utils/imageParseRotation';
import { ImageParseBlocksOverlay } from './ImageParseBlocksOverlay';
import { PdfPreviewLoading } from './PdfPreviewLoading';

interface PdfDocumentPageProps {
  pageNumber: number;
  width: number;
  height: number;
  label: string;
  active: boolean;
  renderCanvas: boolean;
  ready: boolean;
  showLoading?: boolean;
  rotation: number;
  /** This page's server rotation-adaptation angle. 0 means the preview keeps the original orientation. */
  serverAngle?: number;
  blocks: readonly ImageParseLayoutBlock[];
  showBlocks?: boolean;
  selectedBlockId?: string;
  hoveredBlockId?: string;
  linkedHighlight?: boolean;
  onHoverBlock?: (id: string | undefined) => void;
  onSelectBlock?: (id: string, page: number) => void;
  setPageNode: (pageNumber: number, node: HTMLElement | null) => void;
  setPageCanvas: (pageNumber: number, canvas: HTMLCanvasElement | null) => void;
}

/** PDF single-page skeleton and recognition boxes; mount the canvas and interaction layer only for pages near the viewport, and isolate linkage marks to the current page. */
export const PdfDocumentPage = memo(function PdfDocumentPage({
  pageNumber,
  width,
  height,
  label,
  active,
  renderCanvas,
  ready,
  showLoading = true,
  rotation,
  serverAngle = 0,
  blocks,
  showBlocks,
  selectedBlockId,
  hoveredBlockId,
  linkedHighlight,
  onHoverBlock,
  onSelectBlock,
  setPageNode,
  setPageCanvas,
}: PdfDocumentPageProps) {
  const pageRef = useCallback(
    (node: HTMLDivElement | null) => setPageNode(pageNumber, node),
    [pageNumber, setPageNode],
  );
  const canvasRef = useCallback(
    (node: HTMLCanvasElement | null) => setPageCanvas(pageNumber, node),
    [pageNumber, setPageCanvas],
  );
  const selectBlock = useCallback(
    (id: string) => onSelectBlock?.(id, pageNumber),
    [onSelectBlock, pageNumber],
  );
  const userAngle = ((rotation % 360) + 360) % 360;
  const serverTurns = ((serverAngle % 360) + 360) % 360;
  // During server rotation adaptation, leave the boxes in the rotation-adaptation coordinate system and rotate only the base image. If the boxes rotate with the base image, the highlight lands at the bottom of the page, and in a multi-page run it presses onto the next page's header.
  const serverUpright = serverTurns !== 0 && userAngle === 0;
  const bounds = serverUpright ? rotatedPageBounds(width, height, serverAngle) : { width, height };
  const overlayBlocks = useMemo(
    () =>
      serverUpright
        ? rotateImageParseBlocks(blocks, serverAngle)
        : rotateImageParseBlocks(blocks, rotation),
    [blocks, rotation, serverAngle, serverUpright],
  );
  const canvas = renderCanvas ? (
    <canvas
      ref={canvasRef}
      {...(active ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true })}
      className={cn('block h-full w-full', !ready && 'invisible')}
    />
  ) : null;
  const loading =
    renderCanvas && !ready && showLoading ? (
      <PdfPreviewLoading className="absolute inset-0 overflow-hidden" />
    ) : null;
  const overlay =
    renderCanvas && ready && showBlocks && onSelectBlock ? (
      <ImageParseBlocksOverlay
        blocks={overlayBlocks}
        selectedBlockId={active ? selectedBlockId : undefined}
        hoveredBlockId={active ? hoveredBlockId : undefined}
        linkedHighlight={active && linkedHighlight}
        onHoverBlock={active ? onHoverBlock : undefined}
        onSelect={selectBlock}
      />
    ) : null;
  return (
    <div
      data-pdf-page={pageNumber}
      ref={pageRef}
      style={
        {
          '--pdf-page-width': `${bounds.width}px`,
          '--pdf-page-height': `${bounds.height}px`,
          width: 'calc(var(--pdf-page-width) * var(--pdf-live-scale, 1))',
          height: 'calc(var(--pdf-page-height) * var(--pdf-live-scale, 1))',
          overflow: 'hidden',
        } as CSSProperties
      }
      className="relative shrink-0 bg-background shadow-sm [contain:layout_paint] [content-visibility:auto]"
    >
      {serverUpright ? (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: `calc(${width}px * var(--pdf-live-scale, 1))`,
            height: `calc(${height}px * var(--pdf-live-scale, 1))`,
            transform: `translate(-50%, -50%) rotate(${-serverAngle}deg)`,
          }}
        >
          {canvas}
          {loading}
        </div>
      ) : (
        <>
          {canvas}
          {loading}
        </>
      )}
      {overlay}
    </div>
  );
});
