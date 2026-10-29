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
  /** 居中弹窗或右侧抽屉。 */
  variant?: 'dialog' | 'sheet-right';
  /** 覆盖遮罩样式；右侧抽屉可在桌面端弱化遮罩。 */
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
                  // 移动端：底部抽屉
                  'inset-x-0 bottom-0 max-h-[85vh] w-full rounded-t-2xl',
                  'shadow-[0_-8px_30px_-4px_rgba(0,0,0,0.12)]',
                  '[animation:map-sheet-in_250ms_ease-out]',
                  'data-[state=closed]:[animation:map-sheet-out_200ms_ease-in]',
                  // 桌面端（≥sm）：居中弹窗。
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
          {/* 内层滚动区：长内容在此纵向滚动；DialogHeader 用 sticky 钉在顶部，关闭键固定在 Content 角上。
              注意：这里不能有 pt——sticky top-0 在带 padding-top 的滚动容器里会吸附到 padding 边而非顶边，
              把头部整体下压，导致标题与关闭键错位、顶部露白。顶部留白改由 DialogHeader 自己的 pt 提供。
              scroll-pt-16 给 scroll-into-view（如 autoFocus 输入框）留出 sticky 头部高度，
              避免聚焦时把首个字段标签滚到头部下方被裁切。 */}
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
  // sticky 钉在内层滚动区顶部：用 -mx 把 bg-card 铺满 Content 宽度（抵消滚动区的 px），
  // 右侧 pr-12 给关闭键（X，绝对定位于 Content 的 top-5/6、right-5/6）留位，bg-card 遮挡下方滚动内容。
  // 关键：不要再加 -mt 抵消滚动区 pt——滚动区已无 pt，顶部留白由本头部自己的 pt-5/pt-6 提供，
  // 这样标题文字中心与关闭键中心对齐；负 mt 会被 sticky 夹回 padding 边，反而把标题压低、与 X 错位。
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

// 接到 Radix 原语：DialogPrimitive.Title 会生成 id 并让 Content 自动 aria-labelledby，
// 否则 Radix 会对每个 DialogContent 报「requires a DialogTitle」无障碍告警。
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
  // sticky 钉在内层滚动区底部，与 DialogHeader 的 sticky top 对称：长表单时操作按钮始终吸底，不随内容滚走。
  // -mx 全宽铺 bg-card 盖住下方滚动内容；顶部 border + bg-card 与内容分隔，footer 自身 pb 提供底部留白（含移动端安全区）。
  //
  // 关键：滚动区带有底部 padding（供无 footer 的弹窗留白），而 `position:sticky` 的吸附基准是滚动容器的
  // content-box（padding 内侧）——若用 `bottom-0`，footer 会停在 padding 上沿，其下方露出与 pb 等高的空白，
  // 按钮看起来“没贴到右下角”。这里把吸附点 `bottom` 设为负的 pb（-mb 同步抵消该段对滚动高度的占用），
  // 使 footer 真正贴到卡片底边，短表单与长表单滚动到底时都无留白。
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
