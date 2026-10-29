import { useTranslation } from 'react-i18next';
import { Button, cn } from '@map/ui';
import { useAppStore } from '@map/store';

import { imageParseBlockId, imageParseBlockRegions } from '../../utils/imageParseBlocks';
import type { ImageParseLayoutBlock } from '../../utils/imageParseSample';

interface ImageParseBlocksOverlayProps {
  blocks: readonly ImageParseLayoutBlock[];
  selectedBlockId?: string;
  hoveredBlockId?: string;
  linkedHighlight?: boolean;
  onHoverBlock?: (id: string | undefined) => void;
  onSelect: (id: string) => void;
}

/**
 * Recognition boxes in one style. Keep region location, reading order, and keyboard interaction, and do not show confidence.
 * @param props Original regions, linkage state, and selection callback
 * @returns A recognition-box overlay that shares a coordinate system with the original image
 */
export function ImageParseBlocksOverlay({
  blocks,
  selectedBlockId,
  hoveredBlockId,
  linkedHighlight,
  onHoverBlock,
  onSelect,
}: ImageParseBlocksOverlayProps) {
  const { t } = useTranslation('playground');
  const showOrder = useAppStore((s) => s.playground.imageParseShowOrder);
  return (
    <div className="pointer-events-none absolute inset-0">
      {blocks.flatMap((block, order) => {
        const id = imageParseBlockId(block, order);
        // Backend order starts at 0; the UI starts at 1, so users do not treat the first block as an error.
        const readingOrder = (block.order ?? order) + 1;
        return imageParseBlockRegions(block).map((region, regionIndex) => {
          const selected = id === selectedBlockId;
          const highlighted = id === hoveredBlockId || Boolean(linkedHighlight && selected);
          return (
            <div
              key={`${id}:${region.x}:${region.y}`}
              style={{
                left: `${region.x * 100}%`,
                top: `${region.y * 100}%`,
                width: `${region.w * 100}%`,
                height: `${region.h * 100}%`,
              }}
              className={cn('absolute hover:z-10 focus-within:z-10', selected && 'z-10')}
            >
              <Button
                type="button"
                variant="ghost"
                aria-label={t('imageParseBlockNumber', { number: readingOrder })}
                aria-pressed={selected}
                title={showOrder ? `#${readingOrder} ${block.label ?? block.kind}` : undefined}
                data-origin-block-id={id}
                data-origin-region-index={regionIndex}
                data-origin-highlight={highlighted || undefined}
                onMouseEnter={() => onHoverBlock?.(id)}
                onMouseLeave={() => onHoverBlock?.(undefined)}
                onFocus={() => onHoverBlock?.(id)}
                onBlur={() => onHoverBlock?.(undefined)}
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(id);
                }}
                className={cn(
                  // The border is independent of size, so a very thin text box is not stretched by the button border's minimum height.
                  'pointer-events-auto absolute inset-0 h-full w-full min-h-0 cursor-pointer overflow-visible rounded-sm border-0 bg-transparent p-0 hover:border-primary hover:bg-primary/10 hover:text-primary focus-visible:border-primary focus-visible:bg-primary/10 focus-visible:text-primary focus-visible:ring-2 focus-visible:ring-ring',
                  'border-border/60 text-muted-foreground after:pointer-events-none after:absolute after:-inset-px after:rounded-[inherit] after:border after:border-[color:inherit]',
                  (selected || highlighted) &&
                    'border-primary bg-primary/10 text-primary after:border-2',
                  selected && 'z-10',
                  highlighted && 'after:ring-1 after:ring-primary/60',
                )}
              />
              {showOrder && regionIndex === 0 ? (
                <span
                  aria-hidden="true"
                  data-block-order={readingOrder}
                  className="pointer-events-none absolute left-0 top-0 z-20 rounded-br-sm bg-primary/90 px-1 text-[10px] font-semibold leading-4 tabular-nums text-primary-foreground"
                >
                  {readingOrder}
                </span>
              ) : null}
            </div>
          );
        });
      })}
    </div>
  );
}
