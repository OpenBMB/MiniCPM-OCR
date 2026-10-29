/**
 * 图像解析原图栏（有图后的工作台）。
 *
 * 用途：核对 OCR 结果要能凑近看清小字、印章、手写，所以这一栏是个真的看图器——
 * 默认滚轮纵向阅读、Ctrl/Meta 滚轮锚点缩放、受限平移、旋转、还原与全屏。
 * 视图控制常显：缩放旋转是核对时的主操作，做成悬停出现等于没有。
 *
 * 解析中要在图上叠扫描与版面框，所以图框尺寸必须精确——包裹层用图片真实宽高比
 * 铺满视口宽度，长文档顶部先展示，覆盖层 inset-0 与原图使用同一坐标系。
 * 原图按目标尺寸绘制，覆盖层使用同一坐标系；框线和编号保持固定大小。
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
  /** 已解析出的可显示地址 */
  previewSrc: string;
  disabled?: boolean;
  onPreview: (src: string) => void;
  onClear: () => void;
  blocks: readonly ImageParseLayoutBlock[];
  /** 服务端旋转摆正信息；bbox/regions 坐标已基于摆正后的图。 */
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
 * 原图看图器。
 * @param attachment 当前图片附件
 * @param previewSrc 图片地址
 * @param onPreview 打开全屏预览
 * @param blocks 版面块，空数组表示不画框
 * @param progress 解析进度快照
 * @param parsing 是否正在解析
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
  // 保存原始图尺寸；服务端摆正后包裹层按旋转后的外接框定尺。
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
  // 两个 ref 回调先解构出来：把 zoom 的属性直接塞进 ref 属性，lint 会把整个 zoom 当成 ref。
  const { reset, setViewport, setContent, focusBlock, scrollToProgress } = zoom;
  const attachViewport = useCallback(
    (node: HTMLElement | null) => {
      viewportRef.current = node;
      setViewport(node);
      originScrollRef?.(node);
    },
    [setViewport, originScrollRef],
  );

  // 换图后回到初始视图，否则新图会带着上一张的倍数与角度。
  useEffect(() => {
    reset();
  }, [previewSrc, reset]);

  useLayoutEffect(() => {
    if (pendingProgress.current?.src !== previewSrc) pendingProgress.current = undefined;
    if (scrollProgress === undefined || !Number.isFinite(scrollProgress)) {
      // 外部请求消费后只结束其自身确认，不清除适合宽度切换时仍待确认的点击定位。
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
    // 确认实际位置并消费请求；程序定位只禁止反向回写，不能吞掉位置确认。
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
    // 收起的图片栏测不到尺寸；重新展开后首次测量完成时执行未完成的定位。
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
              // touch-none：触屏上要拿到 pointermove 才能平移，否则会被当成页面滚动吞掉
              'flex h-full min-h-0 w-full touch-none items-center justify-center overflow-hidden',
              stageCursor(zoom),
            )}
          >
            <span
              ref={setContent}
              style={{ aspectRatio: ratio ? String(ratio) : undefined }}
              // min-h-0：服务端 90/270 度摆正后宽高比与原图相反，aspect-ratio 默认的
              // min-height:auto 会被按原图比例排版的测量图撑高，框层随之被纵向拉伸。
              className="relative flex min-h-0 w-full shrink-0 items-center justify-center"
            >
              {/* 仅用于测量原图尺寸；拿到比例后脱离文档流，容器高度只由摆正后的比例决定。 */}
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
                // 边界校正立即生效，避免 resize 后位移过渡短暂露出图片外的空白。
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

/** 视口光标：文档可以在边界内拖动，按下时切换为抓取状态。 */
function stageCursor(zoom: ImageZoom): string {
  return zoom.dragging ? 'cursor-grabbing' : 'cursor-grab';
}
