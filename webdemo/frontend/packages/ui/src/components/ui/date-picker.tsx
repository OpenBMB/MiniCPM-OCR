import * as React from 'react';
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  useClick,
  useDismiss,
  useRole,
  useInteractions,
  FloatingPortal,
  FloatingFocusManager,
} from '@floating-ui/react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { cn } from '../../utils';

export interface DatePickerProps {
  /** 受控值，格式 YYYY-MM-DD；空字符串表示未选择 */
  value?: string;
  /** 选择变更回调，回传 YYYY-MM-DD（清除时回传空字符串） */
  onChange?: (value: string) => void;
  /** 可选最小日期（含），YYYY-MM-DD */
  min?: string;
  /** 可选最大日期（含），YYYY-MM-DD */
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  /** 触发器无障碍名称 */
  ariaLabel?: string;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

interface YMD {
  y: number;
  m: number; // 0-11
  d: number;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 解析 YYYY-MM-DD，避免 new Date(string) 的 UTC 时区偏移 */
function parse(value?: string): YMD | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]) - 1;
  const d = Number(match[3]);
  if (m < 0 || m > 11 || d < 1 || d > 31) return null;
  return { y, m, d };
}

function format({ y, m, d }: YMD): string {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

function display({ y, m, d }: YMD): string {
  return `${y}/${pad(m + 1)}/${pad(d)}`;
}

/** 仅按年月日比较，忽略时分秒 */
function sameDay(a: YMD, b: YMD): boolean {
  return a.y === b.y && a.m === b.m && a.d === b.d;
}

/** 返回 < 0 表示 a 早于 b */
function compare(a: YMD, b: YMD): number {
  if (a.y !== b.y) return a.y - b.y;
  if (a.m !== b.m) return a.m - b.m;
  return a.d - b.d;
}

function todayYMD(): YMD {
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
}

/**
 * 日期选择器（@map/ui）。
 *
 * 用途：替代浏览器原生 <input type="date">，提供与设计系统一致的触发器与日历浮层。
 * 受控组件：值由调用方持有，内部只负责解析、渲染日历与回传 YYYY-MM-DD。
 *
 * @param value 当前值 YYYY-MM-DD
 * @param onChange 选择/清除回调
 * @param min/max 可选的可选范围边界（含）
 */
function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = '选择日期',
  disabled,
  className,
  id,
  ariaLabel,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const selected = React.useMemo(() => parse(value), [value]);
  const minYMD = React.useMemo(() => parse(min), [min]);
  const maxYMD = React.useMemo(() => parse(max), [max]);

  // 当前显示的年月：优先选中值，否则今天
  const [view, setView] = React.useState<{ y: number; m: number }>(() => {
    const base = selected ?? todayYMD();
    return { y: base.y, m: base.m };
  });

  // 打开时把视图对齐到选中值（或今天）
  React.useEffect(() => {
    if (open) {
      const base = selected ?? todayYMD();
      setView({ y: base.y, m: base.m });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-start',
    middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const click = useClick(context, { enabled: !disabled });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'dialog' });
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role]);

  const today = todayYMD();

  // 生成 6 行 × 7 列日历网格（含上/下月补位）
  const cells = React.useMemo(() => {
    const firstWeekday = new Date(view.y, view.m, 1).getDay();
    const start = new Date(view.y, view.m, 1 - firstWeekday);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
    });
  }, [view]);

  function outOfRange(cell: YMD): boolean {
    if (minYMD && compare(cell, minYMD) < 0) return true;
    if (maxYMD && compare(cell, maxYMD) > 0) return true;
    return false;
  }

  function pick(cell: YMD) {
    if (outOfRange(cell)) return;
    onChange?.(format(cell));
    setOpen(false);
  }

  function shiftMonth(delta: number) {
    setView((v) => {
      const next = new Date(v.y, v.m + delta, 1);
      return { y: next.getFullYear(), m: next.getMonth() };
    });
  }

  function shiftYear(delta: number) {
    setView((v) => ({ y: v.y + delta, m: v.m }));
  }

  return (
    <>
      <button
        type="button"
        id={id}
        ref={refs.setReference}
        disabled={disabled}
        aria-label={ariaLabel}
        className={cn(
          'group flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 py-1.5 text-[13px]',
          'transition-[color,border-color,box-shadow] duration-150',
          'hover:border-primary/30',
          'focus:outline-none focus-visible:border-primary/50 focus-visible:ring-1 focus-visible:ring-primary/20',
          open && 'border-primary/30',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...getReferenceProps()}
      >
        <span className={cn('truncate', !selected && 'text-muted-foreground/60')}>
          {selected ? display(selected) : placeholder}
        </span>
        <CalendarIcon className="size-3.5 shrink-0 text-muted-foreground/50" strokeWidth={2} />
      </button>

      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              className={cn(
                'z-[60] w-[17rem] rounded-xl border border-border/60 bg-card p-3 text-card-foreground',
                'shadow-[0_8px_30px_-4px_rgba(0,0,0,0.1),0_2px_8px_-2px_rgba(0,0,0,0.06)]',
                'focus:outline-none',
              )}
              {...getFloatingProps()}
            >
              {/* 头部：年/月导航 */}
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-0.5">
                  <NavButton ariaLabel="上一年" onClick={() => shiftYear(-1)}>
                    <ChevronsLeft className="size-4" />
                  </NavButton>
                  <NavButton ariaLabel="上个月" onClick={() => shiftMonth(-1)}>
                    <ChevronLeft className="size-4" />
                  </NavButton>
                </div>
                <span className="text-[13px] font-semibold text-foreground">
                  {view.y}年{pad(view.m + 1)}月
                </span>
                <div className="flex items-center gap-0.5">
                  <NavButton ariaLabel="下个月" onClick={() => shiftMonth(1)}>
                    <ChevronRight className="size-4" />
                  </NavButton>
                  <NavButton ariaLabel="下一年" onClick={() => shiftYear(1)}>
                    <ChevronsRight className="size-4" />
                  </NavButton>
                </div>
              </div>

              {/* 星期表头 */}
              <div className="grid grid-cols-7 gap-0.5">
                {WEEKDAYS.map((w) => (
                  <div
                    key={w}
                    className="flex h-7 items-center justify-center text-[11px] font-medium text-muted-foreground/60"
                  >
                    {w}
                  </div>
                ))}
              </div>

              {/* 日期网格 */}
              <div className="grid grid-cols-7 gap-0.5">
                {cells.map((cell) => {
                  const inMonth = cell.m === view.m;
                  const isToday = sameDay(cell, today);
                  const isSelected = selected ? sameDay(cell, selected) : false;
                  const disabledCell = outOfRange(cell);
                  return (
                    <button
                      key={`${cell.y}-${cell.m}-${cell.d}`}
                      type="button"
                      disabled={disabledCell}
                      onClick={() => pick(cell)}
                      className={cn(
                        'flex h-8 items-center justify-center rounded-md text-[13px] tabular-nums transition-colors',
                        'focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/30',
                        !inMonth && 'text-muted-foreground/35',
                        inMonth && !isSelected && 'text-foreground hover:bg-primary/[0.08]',
                        isSelected && 'bg-primary font-medium text-primary-foreground hover:bg-primary',
                        !isSelected && isToday && 'font-semibold text-primary',
                        disabledCell && 'cursor-not-allowed opacity-30 hover:bg-transparent',
                      )}
                    >
                      {cell.d}
                    </button>
                  );
                })}
              </div>

              {/* 底部操作 */}
              <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    onChange?.('');
                    setOpen(false);
                  }}
                  className="rounded-md px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  清除
                </button>
                <button
                  type="button"
                  onClick={() => pick(today)}
                  disabled={outOfRange(today)}
                  className="rounded-md px-2 py-1 text-[12px] font-medium text-primary transition-colors hover:bg-primary/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  今天
                </button>
              </div>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}

function NavButton({
  children,
  onClick,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
    >
      {children}
    </button>
  );
}

export { DatePicker };
