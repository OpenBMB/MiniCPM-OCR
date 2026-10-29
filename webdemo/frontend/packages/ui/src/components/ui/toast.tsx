import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from 'react';
import { cn } from '../../utils';

/* ---- Types ---- */

type ToastVariant = 'default' | 'success' | 'error' | 'warning';

interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
}

interface ToastContextValue {
  toast: (opts: Omit<ToastItem, 'id'>) => void;
  dismiss: (id: string) => void;
}

/* ---- Context ---- */

const ToastContext = createContext<ToastContextValue | null>(null);

function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

/* ---- Provider ---- */

let globalId = 0;

function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((opts: Omit<ToastItem, 'id'>) => {
    const id = `toast-${++globalId}`;
    setToasts((prev) => [...prev, { ...opts, id }]);
  }, []);

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/* ---- Container ---- */

const toastKeyframes = `
@keyframes map-toast-in  { from { opacity: 0; transform: translateY(-8px) translateX(16px); } to { opacity: 1; transform: translateY(0) translateX(0); } }
@keyframes map-toast-out { from { opacity: 1; transform: translateY(0) translateX(0); } to { opacity: 0; transform: translateY(-8px) translateX(16px); } }
`;

let toastKeyframesInjected = false;
function ensureToastKeyframes() {
  if (toastKeyframesInjected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.textContent = toastKeyframes;
  document.head.appendChild(style);
  toastKeyframesInjected = true;
}

function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    ensureToastKeyframes();
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 left-4 right-4 sm:left-auto sm:right-4 z-[100] flex flex-col gap-2 sm:max-w-sm sm:w-full pointer-events-none">
      {toasts.map((t) => (
        <ToastCard key={t.id} item={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

/* ---- Single Toast ---- */

const iconMap: Record<ToastVariant, ReactNode> = {
  default: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-primary"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  ),
  success: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-emerald-500"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ),
  error: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-destructive"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </svg>
  ),
  warning: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-amber-500"
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  ),
};

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  const [exiting, setExiting] = useState(false);
  const duration = item.duration ?? 3000;

  useEffect(() => {
    const timer = setTimeout(() => setExiting(true), duration);
    return () => clearTimeout(timer);
  }, [duration]);

  useEffect(() => {
    if (!exiting) return;
    const timer = setTimeout(() => onDismiss(item.id), 200);
    return () => clearTimeout(timer);
  }, [exiting, item.id, onDismiss]);

  const variant = item.variant ?? 'default';

  return (
    <div
      className={cn(
        'pointer-events-auto flex items-start gap-3 rounded-lg border border-border/40 bg-card p-4 shadow-[0_8px_30px_-4px_rgba(0,0,0,0.1)]',
        exiting
          ? '[animation:map-toast-out_200ms_ease-in_forwards]'
          : '[animation:map-toast-in_250ms_ease-out]',
      )}
    >
      <span className="mt-0.5 shrink-0">{iconMap[variant]}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{item.title}</p>
        {item.description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => setExiting(true)}
        className="shrink-0 rounded-md p-0.5 text-muted-foreground/40 hover:text-foreground transition-colors cursor-pointer"
      >
        <svg
          width="14"
          height="14"
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
    </div>
  );
}

export { ToastProvider, useToast };
export type { ToastItem, ToastVariant };
