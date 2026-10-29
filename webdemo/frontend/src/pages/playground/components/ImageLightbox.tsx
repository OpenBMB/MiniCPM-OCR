/**
 * 图片全屏预览（lightbox）。
 *
 * 用途：点击原图或对话里的缩略图后放大核对。createPortal 到 body，点遮罩 / 关闭键 / Esc 关闭。
 * 受控：src 为空时不渲染。
 *
 * 校对场景要求能凑近看：滚轮缩放（锚在光标）、拖拽平移、90° 旋转、双击放大。
 * 视图换算全在 useImageZoom 里，和内嵌原图栏共用同一套手感与边界。
 * 遮罩整体作为缩放视口，滚轮落在图外也能缩放；指针手势只挂在图上，
 * 否则在遮罩上拖完松手会被当成「点遮罩关闭」。
 *
 * 无障碍上补齐了模态该有的东西——aria-modal、Tab 焦点不逸出、关闭后焦点还给来源元素。
 * 层级用 z-50（模态层）；此前误用 z-[100]，那是 toast 的层，会压住提示。
 */

import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { RotateCcw, RotateCw, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { cn } from '@map/ui';
import { useImageZoom, type ImageZoom } from '../hooks/useImageZoom';

interface ImageLightboxProps {
  /** 预览图片地址；为空表示关闭 */
  src: string | null;
  onClose: () => void;
}

const FOCUSABLE = 'button:not([disabled])';

/**
 * 图片预览遮罩。
 * @param src 图片地址，为空则不渲染
 * @param onClose 关闭回调
 */
export function ImageLightbox({ src, onClose }: ImageLightboxProps) {
  const { t } = useTranslation('playground');
  const zoom = useImageZoom();
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // ref 回调先解构出来：把 zoom 的属性直接塞进 ref 属性，lint 会把整个 zoom 当成 ref。
  const { reset, setViewport, setContent } = zoom;

  // 遮罩既要留给键盘/焦点逻辑用，又要交给 zoom 当缩放视口，所以这里合并两个 ref。
  // 回调体必须用花括号：React 19 会把 ref 回调的返回值当成清理函数。
  const attachDialog = useCallback(
    (node: HTMLDivElement | null) => {
      dialogRef.current = node;
      setViewport(node);
    },
    [setViewport],
  );

  // Esc 关闭 + Tab 循环。模态不锁 Tab，焦点会跑到背后的页面上去。
  useEffect(() => {
    if (!src) return undefined;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes?.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [src, onClose]);

  // 打开时记住来源元素并把焦点收进来，关闭时还回去。
  useEffect(() => {
    if (!src) return undefined;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => restoreFocusRef.current?.focus();
  }, [src]);

  // 换图时回到初始视图，避免带着上一张的缩放和角度。
  useEffect(() => {
    if (src) reset();
  }, [src, reset]);

  const handleBackdrop = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) onClose();
    },
    [onClose],
  );

  if (!src) return null;

  return createPortal(
    <div
      ref={attachDialog}
      role="dialog"
      aria-modal="true"
      aria-label={t('imagePreview')}
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/70 p-6 backdrop-blur-sm"
    >
      <img
        ref={setContent}
        src={src}
        alt={t('imagePreview')}
        draggable={false}
        onDoubleClick={zoom.onDoubleClick}
        onPointerDown={zoom.onPointerDown}
        onPointerMove={zoom.onPointerMove}
        onPointerUp={zoom.onPointerUp}
        onPointerCancel={zoom.onPointerUp}
        style={{ transform: zoom.transform }}
        className={cn(
          // touch-none：触屏上要拿到 pointermove 才能平移
          // 不加圆角：原图是直角，削角等于改了用户的图；边界靠投影而不是裁切
          'max-h-full max-w-full touch-none select-none object-contain shadow-2xl will-change-transform',
          // 滚轮与拖拽期间关掉过渡才跟手，按钮与旋转这类离散操作仍然走动画
          zoom.animated && 'transition-transform duration-150 ease-out motion-reduce:transition-none',
          cursorClass(zoom),
        )}
      />

      <div className="absolute right-5 top-5 flex items-center gap-1 rounded-full bg-foreground/70 p-1 backdrop-blur-sm">
        <ToolButton label={t('imageParseZoomIn')} onClick={zoom.zoomIn}>
          <ZoomIn className="h-4 w-4" aria-hidden="true" />
        </ToolButton>
        <ToolButton label={t('imageParseZoomOut')} onClick={zoom.zoomOut}>
          <ZoomOut className="h-4 w-4" aria-hidden="true" />
        </ToolButton>
        <ToolButton label={t('imageParseRotateLeft')} onClick={() => zoom.rotate(-1)}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        </ToolButton>
        <ToolButton label={t('imageParseRotateRight')} onClick={() => zoom.rotate(1)}>
          <RotateCw className="h-4 w-4" aria-hidden="true" />
        </ToolButton>
        {zoom.transformed ? (
          <ToolButton label={t('imageParseZoomReset')} onClick={zoom.reset}>
            <Undo2 className="h-4 w-4" aria-hidden="true" />
          </ToolButton>
        ) : null}
        <ToolButton label={t('closePreview')} onClick={onClose}>
          <X className="h-4 w-4" aria-hidden="true" />
        </ToolButton>
      </div>

      <p className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-foreground/70 px-3 py-1 text-xs text-background">
        {zoom.transformed ? `${Math.round(zoom.scale * 100)}% · ` : ''}
        {t('imageParseZoomHint')}
      </p>
    </div>,
    document.body,
  );
}

/** 光标：任何倍数都能拖，拖到哪停哪，所以只分抓着与没抓着。 */
function cursorClass(zoom: ImageZoom): string {
  return zoom.dragging ? 'cursor-grabbing' : 'cursor-grab';
}

/** 预览工具按钮：反色圆形图标键，触摸目标不小于 44px。 */
function ToolButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-11 w-11 items-center justify-center rounded-full text-background transition-colors hover:bg-background/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background sm:h-9 sm:w-9"
    >
      {children}
    </button>
  );
}
