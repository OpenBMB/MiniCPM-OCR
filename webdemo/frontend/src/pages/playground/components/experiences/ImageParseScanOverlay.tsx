/**
 * Recognition-process overlay on the original image.
 *
 * Purpose: while parsing, stack a scan band and detected layout boxes on the original so "recognition in progress" is visible on a particular block, rather than only a spinner in the right column. The overlay and the result column share the same progress snapshot from useImageParse.
 *
 * Shared examples use fixed demo coordinates; a real document shows only the scan band until the server returns coordinates.
 */

import { useTranslation } from 'react-i18next';
import { cn } from '@map/ui';
import { imageParseBlockRegions } from '../../utils/imageParseBlocks';
import type { ImageParseBlockKind, ImageParseLayoutBlock } from '../../utils/imageParseSample';
import type { ImageParseProgressSnapshot } from '../../utils/imageParseSimulation';

interface ImageParseScanOverlayProps {
  blocks: readonly ImageParseLayoutBlock[];
  progress: ImageParseProgressSnapshot | null;
  /** Whether parsing is in progress; when it ends the overlay fades out as a whole */
  active: boolean;
  /** Original-image address, used as a mask for the overlay through its alpha channel */
  maskSrc: string;
}

/** Layout-block type → box-stroke color, taken from the chart palette so they are distinct enough without leaving the tokens. */
const KIND_STYLE: Record<ImageParseBlockKind, { idle: string; done: string }> = {
  header: { idle: 'border-chart-1/50', done: 'border-chart-1 bg-chart-1/10' },
  footer: { idle: 'border-chart-6/50', done: 'border-chart-6 bg-chart-6/10' },
  heading: { idle: 'border-chart-1/50', done: 'border-chart-1 bg-chart-1/10' },
  text: { idle: 'border-chart-5/50', done: 'border-chart-5 bg-chart-5/10' },
  table: { idle: 'border-chart-2/50', done: 'border-chart-2 bg-chart-2/10' },
  formula: { idle: 'border-chart-4/50', done: 'border-chart-4 bg-chart-4/10' },
  list: { idle: 'border-chart-6/50', done: 'border-chart-6 bg-chart-6/10' },
  note: { idle: 'border-chart-3/50', done: 'border-chart-3 bg-chart-3/10' },
  image: { idle: 'border-muted-foreground/40', done: 'border-muted-foreground bg-muted/20' },
  chart: { idle: 'border-chart-2/50', done: 'border-chart-2 bg-chart-2/10' },
  seal: { idle: 'border-destructive/50', done: 'border-destructive bg-destructive/10' },
};

/** Hang a type badge only on these block kinds — text on all 16 boxes would blur into a mass. */
const LABELLED_KINDS: readonly ImageParseBlockKind[] = ['header', 'footer', 'table', 'formula'];

/**
 * Recognition-process overlay.
 * @param blocks Normalized layout coordinates; an empty array means this image draws no boxes
 * @param progress Current progress snapshot
 * @param active Whether parsing is in progress
 * @param maskSrc Original-image address; the overlay shows only on the image's opaque pixels
 */
export function ImageParseScanOverlay({
  blocks,
  progress,
  active,
  maskSrc,
}: ImageParseScanOverlayProps) {
  const { t } = useTranslation('playground');
  if (!active) return null;

  const detected = progress ? Math.min(blocks.length, progress.detectedBlocks) : 0;
  const scanned = progress ? Math.min(blocks.length, progress.scannedBlocks) : 0;

  const mask = `url(${JSON.stringify(maskSrc)})`;

  return (
    // The overlay masks with the original image's own alpha, rather than hard-coding rounded or square corners:
    // When the image has its own rounded corners or a transparent cutout, scanning the rectangular outer frame lets the scan line run into the transparent area and stick out past the image;
    // After a per-pixel mask, the scan has whatever shape the image has.
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{
        maskImage: mask,
        maskSize: '100% 100%',
        maskRepeat: 'no-repeat',
        WebkitMaskImage: mask,
        WebkitMaskSize: '100% 100%',
        WebkitMaskRepeat: 'no-repeat',
      }}
      aria-hidden="true"
    >
      {/* Scan band: a large motion that travels back and forth forever. Under prefers-reduced-motion the whole block is not rendered */}
      <div className="absolute inset-0 motion-reduce:hidden">
        <div className="absolute inset-x-0 h-[14%] animate-[map-image-scan_1.9s_ease-in-out_infinite] bg-gradient-to-b from-transparent via-primary/15 to-transparent">
          <div className="absolute inset-x-0 bottom-0 h-px bg-primary/70 shadow-[0_0_8px_hsl(var(--primary)/0.6)]" />
        </div>
      </div>

      {blocks.slice(0, detected).flatMap((block, index) => {
        const done = index < scanned;
        const style = KIND_STYLE[block.kind];
        const blockKey = block.id ?? block.order ?? `${block.x}:${block.y}`;
        return imageParseBlockRegions(block).map((region) => (
          <div
            key={`${blockKey}:${region.x}:${region.y}`}
            className={cn(
              'absolute rounded-[3px] border',
              'animate-[map-layout-box-in_200ms_ease-out] motion-reduce:animate-none',
              'transition-colors duration-150 ease-out motion-reduce:transition-none',
              done ? style.done : cn('border-dashed', style.idle),
            )}
            style={{
              left: `${region.x * 100}%`,
              top: `${region.y * 100}%`,
              width: `${region.w * 100}%`,
              height: `${region.h * 100}%`,
            }}
          >
            {done && LABELLED_KINDS.includes(block.kind) ? (
              <span className="absolute -top-[9px] left-1 rounded-sm bg-background/90 px-1 text-[9px] font-medium leading-4 text-muted-foreground">
                {t(`imageParseBlock_${block.kind}`)}
              </span>
            ) : null}
          </div>
        ));
      })}
    </div>
  );
}
