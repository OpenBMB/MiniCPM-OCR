/**
 * Full-screen image preview (lightbox).
 *
 * Purpose: enlarge an original image or a chat thumbnail for checking. createPortal to body; click the mask, the close key, or Esc to close. Controlled: render nothing when src is empty.
 *
 * Proofreading needs a close look: wheel zoom (anchored at the cursor), drag to pan, 90° rotation, double-click to enlarge. View math all lives in useImageZoom, sharing one feel and the same bounds with the embedded original-image column. The mask as a whole is the zoom viewport, so a wheel event outside the image still zooms; pointer gestures are attached only to the image, otherwise dragging on the mask and releasing is treated as "click the mask to close."
 *
 * Accessibility fills in what a modal should have — aria-modal, Tab focus that does not escape, and focus returned to the source element on close. The layer is z-50 (the modal layer); z-[100] was used by mistake before, and that is the toast layer, which would cover toasts.
 */

import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { RotateCcw, RotateCw, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { cn } from '@map/ui';
import { useImageZoom, type ImageZoom } from '../hooks/useImageZoom';

interface ImageLightboxProps {
  /** Preview image address; empty means closed */
  src: string | null;
  onClose: () => void;
}

const FOCUSABLE = 'button:not([disabled])';

/**
 * Image preview mask.
 * @param src Image address; render nothing when empty
 * @param onClose Close callback
 */
export function ImageLightbox({ src, onClose }: ImageLightboxProps) {
  const { t } = useTranslation('playground');
  const zoom = useImageZoom();
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // Destructure the ref callback first: stuffing zoom's properties straight into the ref prop makes lint treat the whole zoom object as the ref.
  const { reset, setViewport, setContent } = zoom;

  // The mask is used both by keyboard/focus logic and by zoom as the zoom viewport, so the two refs are merged here.
  // The callback body must use braces: React 19 treats a ref callback's return value as a cleanup function.
  const attachDialog = useCallback(
    (node: HTMLDivElement | null) => {
      dialogRef.current = node;
      setViewport(node);
    },
    [setViewport],
  );

  // Esc closes and Tab cycles. If a modal does not trap Tab, focus runs off onto the page behind it.
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

  // On open, remember the source element and pull focus in; on close, give it back.
  useEffect(() => {
    if (!src) return undefined;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => restoreFocusRef.current?.focus();
  }, [src]);

  // On image change, return to the initial view so the previous image's zoom and angle are not carried over.
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
          // touch-none: on a touch screen, pointermove has to be received before panning works
          // No border radius: the original image has square corners, and clipping the corners changes the user's image; the boundary comes from shadow, not clipping
          'max-h-full max-w-full touch-none select-none object-contain shadow-2xl will-change-transform',
          // Turn transitions off during wheel and drag so they track the hand; discrete actions such as buttons and rotation still animate
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

/** Cursor: it can be dragged at any scale and stops where it is released, so the only distinction is grabbing versus not grabbing. */
function cursorClass(zoom: ImageZoom): string {
  return zoom.dragging ? 'cursor-grabbing' : 'cursor-grab';
}

/** Preview tool button: an inverted circular icon key, with a touch target no smaller than 44px. */
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
