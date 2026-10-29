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
 * 统一样式的识别框，保留区域定位、阅读顺序与键盘交互，不展示置信度。
 * @param props 原始区域、联动状态与选择回调
 * @returns 与原图共用坐标系的识别框覆盖层
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
        // 后端 order 从 0 开始；界面从 1 开始，避免用户把第一个块当成错误。
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
                  // 边框独立于尺寸，避免极薄文本框被按钮边框最小高度撑大。
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
