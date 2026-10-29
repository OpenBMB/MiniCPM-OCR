import { useState, useEffect, useCallback } from 'react';
import { cn } from '../../utils';
import { Button } from './button';

/* ---- Types ---- */

interface ConfirmOptions {
  title?: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'destructive';
}

/* ---- Event-driven imperative API (works across Module Federation) ---- */

const CONFIRM_EVENT = '__ude_confirm__';

interface ConfirmPayload extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

let pendingQueue: ConfirmPayload[] = [];

function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const payload: ConfirmPayload = { ...options, resolve };
    pendingQueue.push(payload);
    window.dispatchEvent(new CustomEvent(CONFIRM_EVENT, { detail: payload }));
  });
}

/**
 * Mount this once in the host app's root to handle confirm dialogs.
 * Renders inside the existing React tree — no createRoot needed.
 */
function ConfirmRenderer() {
  // 懒初始化:挂载前若已有排队的 confirm(跨 MFE 场景),直接取最后一个,避免在 effect 里 setState
  const [current, setCurrent] = useState<ConfirmPayload | null>(() =>
    pendingQueue.length > 0 ? pendingQueue[pendingQueue.length - 1]! : null,
  );

  useEffect(() => {
    const handler = (e: Event) => {
      const payload = (e as CustomEvent<ConfirmPayload>).detail;
      setCurrent(payload);
    };
    window.addEventListener(CONFIRM_EVENT, handler);
    return () => window.removeEventListener(CONFIRM_EVENT, handler);
  }, []);

  const handleConfirm = useCallback(() => {
    current?.resolve(true);
    pendingQueue = pendingQueue.filter((p) => p !== current);
    setCurrent(null);
  }, [current]);

  const handleCancel = useCallback(() => {
    current?.resolve(false);
    pendingQueue = pendingQueue.filter((p) => p !== current);
    setCurrent(null);
  }, [current]);

  if (!current) return null;

  return <ConfirmDialog {...current} onConfirm={handleConfirm} onCancel={handleCancel} />;
}

/* ---- Internal component ---- */

const confirmKeyframes = `
@keyframes map-confirm-overlay-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes map-confirm-overlay-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes map-confirm-in { from { opacity: 0; transform: translate(-50%, -50%) scale(0.95); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
@keyframes map-confirm-out { from { opacity: 1; transform: translate(-50%, -50%) scale(1); } to { opacity: 0; transform: translate(-50%, -50%) scale(0.95); } }
@keyframes map-confirm-sheet-in  { from { transform: translateY(100%); } to { transform: translateY(0); } }
@keyframes map-confirm-sheet-out { from { transform: translateY(0); } to { transform: translateY(100%); } }
`;

interface ConfirmDialogProps extends ConfirmOptions {
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({
  title = '确认操作',
  description,
  confirmText = '确认',
  cancelText = '取消',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [closing, setClosing] = useState(false);

  // 关闭前先播放退出动画(180ms)再回调;用 useCallback 保证 effect 依赖稳定
  const handleCancel = useCallback(() => {
    setClosing(true);
    setTimeout(onCancel, 180);
  }, [onCancel]);
  const handleConfirm = useCallback(() => {
    setClosing(true);
    setTimeout(onConfirm, 180);
  }, [onConfirm]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCancel();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [handleCancel]);

  const iconColor = variant === 'destructive' ? 'text-destructive' : 'text-primary';

  const confirmBody = (
    <>
      <div className="flex gap-3">
        <div className={cn('mt-0.5 shrink-0', iconColor)}>
          {variant === 'destructive' ? (
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
          ) : (
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>
        </div>
      </div>
    </>
  );

  return (
    <>
      <style>{confirmKeyframes}</style>
      {/* Overlay */}
      <div
        className={cn(
          // Radix modal Dialog 打开时会给 body 置 pointer-events:none；confirm 渲染在普通
          // React 树里会继承该值导致整层不可点，必须显式恢复 pointer-events。
          'pointer-events-auto fixed inset-0 z-[80] bg-black/40 backdrop-blur-[2px]',
          closing
            ? '[animation:map-confirm-overlay-out_180ms_ease-in_forwards]'
            : '[animation:map-confirm-overlay-in_200ms_ease-out]',
        )}
        onClick={handleCancel}
      />

      {/* Desktop: centered */}
      <div
        className={cn(
          'pointer-events-auto fixed left-1/2 top-1/2 z-[80] w-full max-w-sm -translate-x-1/2 -translate-y-1/2',
          'rounded-xl border border-border/40 bg-card p-5 shadow-[0_16px_48px_-8px_rgba(0,0,0,0.15)]',
          'hidden sm:block',
          closing
            ? '[animation:map-confirm-out_180ms_ease-in_forwards]'
            : '[animation:map-confirm-in_200ms_ease-out]',
        )}
      >
        {confirmBody}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" className="cursor-pointer" onClick={handleCancel}>
            {cancelText}
          </Button>
          <Button
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            size="sm"
            className="cursor-pointer"
            onClick={handleConfirm}
          >
            {confirmText}
          </Button>
        </div>
      </div>

      {/* Mobile: bottom sheet */}
      <div
        className={cn(
          'pointer-events-auto fixed inset-x-0 bottom-0 z-[80] w-full',
          'rounded-t-2xl bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-[0_-8px_30px_-4px_rgba(0,0,0,0.12)]',
          'sm:hidden',
          closing
            ? '[animation:map-confirm-sheet-out_200ms_ease-in_forwards]'
            : '[animation:map-confirm-sheet-in_250ms_ease-out]',
        )}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-muted-foreground/20" />
        {confirmBody}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button variant="outline" className="cursor-pointer" onClick={handleCancel}>
            {cancelText}
          </Button>
          <Button
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            className="cursor-pointer"
            onClick={handleConfirm}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </>
  );
}

export { confirm, ConfirmRenderer };
export type { ConfirmOptions };
