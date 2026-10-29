import { useState, type ReactNode } from 'react';
import { cn } from '../../utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

export interface PaginationLabels {
  total: (total: number) => ReactNode;
  previousPage: string;
  nextPage: string;
  pageSize: string;
  pageSizeUnit: string;
  jumpTo: string;
  page: string;
}

export interface PaginationProps {
  current: number;
  pageSize: number;
  total: number;
  onChange?: (page: number, pageSize: number) => void;
  className?: string;
  /** 每页条数可选项；传空数组或 showSizeChanger=false 时隐藏选择器。默认 [20, 50, 100]。 */
  pageSizeOptions?: number[];
  /** 是否展示「每页条数」选择器（默认 true） */
  showSizeChanger?: boolean;
  /** 是否展示「跳至 X 页」快捷跳转（默认 true） */
  showQuickJump?: boolean;
  /** 是否展示页码按钮（默认 true）；关闭后仅保留左右翻页按钮。 */
  showPageNumbers?: boolean;
  /** 分页文案，未传入时使用中文默认文案以兼容现有调用方。 */
  labels?: Partial<PaginationLabels>;
}

const DEFAULT_LABELS: PaginationLabels = {
  total: (total) => (
    <>
      共 <span className="font-medium text-foreground">{total}</span> 条数据
    </>
  ),
  previousPage: '上一页',
  nextPage: '下一页',
  pageSize: '每页条数',
  pageSizeUnit: '条/页',
  jumpTo: '跳至',
  page: '页',
};

function Pagination({
  current,
  pageSize,
  total,
  onChange,
  className,
  pageSizeOptions = [20, 50, 100],
  showSizeChanger = true,
  showQuickJump = true,
  showPageNumbers = true,
  labels,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pages = getPageRange(current, totalPages);
  const [jump, setJump] = useState('');
  const copy = { ...DEFAULT_LABELS, ...labels };

  const go = (page: number) => {
    if (page < 1 || page > totalPages || page === current) return;
    onChange?.(page, pageSize);
  };

  // 改每页条数后回到第 1 页，避免越界到空页。
  const changeSize = (size: number) => {
    if (size === pageSize) return;
    onChange?.(1, size);
  };

  const commitJump = () => {
    const n = Number.parseInt(jump, 10);
    setJump('');
    if (!Number.isFinite(n)) return;
    go(Math.min(Math.max(1, n), totalPages));
  };

  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <p className="text-xs text-muted-foreground">{copy.total(total)}</p>

      <div className="flex flex-wrap items-center gap-1.5">
        <PgBtn
          disabled={current <= 1}
          onClick={() => go(current - 1)}
          aria-label={copy.previousPage}
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
            <path d="m15 18-6-6 6-6" />
          </svg>
        </PgBtn>

        {showPageNumbers &&
          pages.map((p, i) =>
            p === '...' ? (
              <span
                key={`dot-${i}`}
                className="flex h-7 w-7 items-center justify-center text-xs text-muted-foreground"
              >
                ···
              </span>
            ) : (
              <PgBtn key={p} active={p === current} onClick={() => go(p as number)}>
                {p}
              </PgBtn>
            ),
          )}

        <PgBtn
          disabled={current >= totalPages}
          onClick={() => go(current + 1)}
          aria-label={copy.nextPage}
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
            <path d="m9 18 6-6-6-6" />
          </svg>
        </PgBtn>

        {showSizeChanger && pageSizeOptions.length > 0 && (
          <Select value={String(pageSize)} onValueChange={(v) => changeSize(Number(v))}>
            <SelectTrigger className="ml-1 h-7 w-[104px] text-xs" aria-label={copy.pageSize}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((size) => (
                <SelectItem key={size} value={String(size)} className="text-xs">
                  {size} {copy.pageSizeUnit}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {showQuickJump && (
          <span className="ml-1 flex items-center gap-1 text-xs text-muted-foreground">
            {copy.jumpTo}
            <input
              value={jump}
              onChange={(e) => setJump(e.target.value.replace(/[^\d]/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitJump();
              }}
              onBlur={() => jump && commitJump()}
              inputMode="numeric"
              aria-label={`${copy.jumpTo}${copy.page}`}
              className="h-7 w-12 rounded-md border border-border bg-card px-2 text-center text-xs text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
            />
            {copy.page}
          </span>
        )}
      </div>
    </div>
  );
}

function PgBtn({
  active,
  disabled,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        'inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-md px-1.5 text-xs font-medium transition-colors cursor-pointer',
        active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        disabled && 'pointer-events-none opacity-40',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function getPageRange(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages: (number | '...')[] = [1];

  if (current > 3) pages.push('...');

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);

  if (current < total - 2) pages.push('...');

  pages.push(total);
  return pages;
}

export { Pagination };
