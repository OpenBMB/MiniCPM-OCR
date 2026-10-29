/**
 * 原图上的识别过程覆盖层。
 *
 * 用途：解析中在原图上叠扫描带与版面检出框，让「正在识别」看得见落在哪一块上，
 * 而不是只在右栏转一个圈。覆盖层与结果栏共用 useImageParse 的同一份进度快照。
 *
 * 共享案例使用固定演示坐标；真实文档在服务端返回坐标前只显示扫描带。
 */

import { useTranslation } from 'react-i18next';
import { cn } from '@map/ui';
import { imageParseBlockRegions } from '../../utils/imageParseBlocks';
import type { ImageParseBlockKind, ImageParseLayoutBlock } from '../../utils/imageParseSample';
import type { ImageParseProgressSnapshot } from '../../utils/imageParseSimulation';

interface ImageParseScanOverlayProps {
  blocks: readonly ImageParseLayoutBlock[];
  progress: ImageParseProgressSnapshot | null;
  /** 是否正在解析；结束后覆盖层整体淡出 */
  active: boolean;
  /** 原图地址，用它的 alpha 通道给覆盖层做遮罩 */
  maskSrc: string;
}

/** 版面块类型 → 框线配色，走图表色板拿到足够区分度又不脱离 token。 */
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

/** 只给这几类块挂类型角标——16 个框全带文字会糊成一片。 */
const LABELLED_KINDS: readonly ImageParseBlockKind[] = ['header', 'footer', 'table', 'formula'];

/**
 * 识别过程覆盖层。
 * @param blocks 归一化版面坐标，空数组表示这张图不画框
 * @param progress 当前进度快照
 * @param active 是否正在解析
 * @param maskSrc 原图地址，覆盖层只在图的不透明像素上显示
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
    // 覆盖层用原图自己的 alpha 做遮罩，而不是写死圆角或直角：
    // 图自带圆角、透明抠图时，按矩形外框扫会让扫描线伸进透明区、凸出在图外；
    // 按像素遮罩后，图是什么形状扫描就是什么形状。
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
      {/* 扫描带：无限来回的大面积动效，prefers-reduced-motion 下整块不渲染 */}
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
