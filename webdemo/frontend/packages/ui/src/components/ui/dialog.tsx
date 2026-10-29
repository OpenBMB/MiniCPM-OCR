import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '../../utils';

const dialogKeyframes = `
@keyframes map-overlay-in  { from { opacity: 0; } to { opacity: 1; } }
@keyframes map-overlay-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes map-dialog-in   { from { opacity: 0; transform: translate(-50%, -50%) scale(0.95); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
@keyframes map-dialog-out  { from { opacity: 1; transform: translate(-50%, -50%) scale(1); } to { opacity: 0; transform: translate(-50%, -50%) scale(0.95); } }
@keyframes map-sheet-in  { from { transform: translateY(100%); } to { transform: translateY(0); } }
@keyframes map-sheet-out { from { transform: translateY(0); } to { transform: translateY(100%); } }
@keyframes map-sheet-right-in  { from { opacity: 0; transform: translateX(100%); } to { opacity: 1; transform: translateX(0); } }
@keyframes map-sheet-right-out { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(100%); } }
`;

let dialogKeyframesInjected = false;
function ensureDialogKeyframes() {
  if (dialogKeyframesInjected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.textContent = dialogKeyframes;
  document.head.appendChild(style);
  dialogKeyframesInjected = true;
}

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]',
      'data-[state=open]:[animation:map-overlay-in_200ms_ease-out]',
      'data-[state=closed]:[animation:map-overlay-out_150ms_ease-in]',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

interface DialogContentProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> {
  onClose?: () => void;
  closeLabel?: string;
  /** Centered dialog or right-side drawer. */
  variant?: 'dialog' | 'sheet-right';
  /** Override overlay styles; a right-side drawer can soften the overlay on desktop. */
  overlayClassName?: string;
}

const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  (
    {
      className,
      children,
      onClose,
      closeLabel = '关闭',
      variant = 'dialog',
      overlayClassName,
      ...props
    },
    ref,
  ) => {
    React.useEffect(() => {
      ensureDialogKeyframes();
    }, []);
    const isRightSheet = variant === 'sheet-right';

    return (
      <DialogPrimitive.Portal container={document.body}>
        <DialogOverlay className={overlayClassName} />
        <DialogPrimitive.Content
          ref={ref}
          onEscapeKeyDown={onClose}
          onPointerDownOutside={onClose}
          className={cn(
            'fixed z-[60] flex flex-col overflow-hidden bg-card focus:outline-none',
            isRightSheet
              ? [
                  'inset-y-0 right-0 w-full max-w-[430px] border-l border-border/60',
                  'shadow-[-16px_0_48px_-16px_rgba(0,0,0,0.2)]',
                  '[animation:map-sheet-right-in_280ms_cubic-bezier(0.22,1,0.36,1)]',
                  'data-[state=closed]:[animation:map-sheet-right-out_200ms_ease-in]',
                  'motion-reduce:animate-none',
                ]
              : [
                  // Mobile: bottom drawer.
                  'inset-x-0 bottom-0 max-h-[85vh] w-full rounded-t-2xl',
                  'shadow-[0_-8px_30px_-4px_rgba(0,0,0,0.12)]',
                  '[animation:map-sheet-in_250ms_ease-out]',
                  'data-[state=closed]:[animation:map-sheet-out_200ms_ease-in]',
                  // Desktop (≥sm): centered dialog.
                  'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[85vh]',
                  'sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2',
                  'sm:rounded-xl sm:border sm:border-border/40',
                  'sm:shadow-[0_16px_48px_-8px_rgba(0,0,0,0.15)]',
                  'sm:[animation:map-dialog-in_200ms_ease-out]',
                  'sm:data-[state=closed]:[animation:map-dialog-out_150ms_ease-in]',
                ],
            className,
          )}
          {...props}
        >
          {!isRightSheet && (
            <div className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/20 sm:hidden" />
          )}
          {/* Inner scroll region: long content scrolls vertically here; DialogHeader sticks to the top, and the close button stays fixed on the Content corner.
              Do not add pt here — sticky top-0 inside a scroll container with padding-top sticks to the padding edge rather than the top edge,
              which pushes the whole header down, misaligns the title and the close button, and leaves a white gap at the top. Top spacing comes from DialogHeader’s own pt.
              scroll-pt-16 reserves the sticky header height for scroll-into-view (for example an autoFocus input),
              so focus does not scroll the first field’s label under the header and clip it. */}
          <div
            data-slot="dialog-scroll-body"
            className="min-h-0 flex-1 scroll-pt-16 overflow-y-auto overscroll-contain px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:px-6 sm:pb-6"
          >
            {children}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="absolute right-5 top-5 z-20 rounded-md p-1 text-muted-foreground/60 transition-colors hover:text-foreground hover:bg-muted cursor-pointer focus:outline-none sm:right-6 sm:top-6"
            aria-label={closeLabel}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    );
  },
);
DialogContent.displayName = 'DialogContent';

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  // Stick to the top of the inner scroll region: -mx spreads bg-card across the Content width (cancelling the scroll region’s px),
  // pr-12 on the right leaves room for the close button (X, absolutely positioned at Content top-5/6 and right-5/6), and bg-card covers content scrolling underneath.
  // Important: do not add -mt to cancel the scroll region’s pt — the scroll region has no pt, and top spacing comes from this header’s own pt-5/pt-6,
  // so the title text center lines up with the close button center; a negative mt is clamped by sticky back to the padding edge, which drops the title and misaligns it with X.
  return (
    <div
      className={cn(
        'sticky top-0 z-10 -mx-5 mb-1 space-y-1.5 bg-card px-5 pb-3 pr-12 pt-5 sm:-mx-6 sm:px-6 sm:pr-12 sm:pt-6',
        className,
      )}
      {...props}
    />
  );
}

// Wired to the Radix primitive: DialogPrimitive.Title generates an id and Content sets aria-labelledby automatically,
// otherwise Radix warns on every DialogContent that it "requires a DialogTitle" for accessibility.
const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-base font-semibold text-foreground', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  // Stick to the bottom of the inner scroll region, mirroring DialogHeader’s sticky top: on a long form the actions stay pinned and do not scroll away.
  // -mx spreads bg-card full width over content scrolling underneath; a top border plus bg-card separates it from the content, and the footer’s own pb supplies bottom spacing (including the mobile safe area).
  //
  // Important: the scroll region has bottom padding (spacing for dialogs with no footer), and the sticky offset for `position:sticky` is the scroll container’s
  // content-box (inside the padding) — with `bottom-0`, the footer stops at the top of that padding and leaves a gap as tall as pb underneath,
  // so the buttons look like they never reach the bottom-right corner. Set the sticky `bottom` to the negative pb (-mb cancels that span’s share of the scroll height),
  // so the footer actually sits on the card’s bottom edge, with no leftover gap for a short form or when a long form is scrolled to the end.
  return (
    <div
      className={cn(
        'sticky -bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-10 -mx-5 -mb-[calc(1.25rem+env(safe-area-inset-bottom))] mt-4 flex flex-col-reverse gap-2 border-t border-border/40 bg-card px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3 sm:-bottom-6 sm:-mx-6 sm:-mb-6 sm:flex-row sm:justify-end sm:px-6 sm:pb-6',
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
};
