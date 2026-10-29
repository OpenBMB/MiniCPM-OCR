import { useEffect, useState, type ReactNode, type TransitionEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../utils';
import { Card, CardContent } from './card';
import { Skeleton } from './skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';
import type { ProColumnDef, ProTableExpandButtonProps, ProTableProps } from './pro-table';

const EXPAND_TRANSITION_MS = 220;

function useExpandAnimation(expanded: boolean) {
  const [mounted, setMounted] = useState(expanded);
  const [open, setOpen] = useState(expanded);

  useEffect(() => {
    let openTimer: ReturnType<typeof setTimeout> | undefined;
    let transitionTimer: ReturnType<typeof setTimeout> | undefined;
    if (expanded) {
      openTimer = setTimeout(() => setOpen(true), 0);
    } else {
      openTimer = setTimeout(() => setOpen(false), 0);
      transitionTimer = setTimeout(() => setMounted(false), EXPAND_TRANSITION_MS);
    }

    return () => {
      if (openTimer) clearTimeout(openTimer);
      if (transitionTimer) clearTimeout(transitionTimer);
    };
  }, [expanded]);

  function handleTransitionEnd(event: TransitionEvent<HTMLDivElement>) {
    if (
      !expanded &&
      event.target === event.currentTarget &&
      event.propertyName === 'grid-template-rows'
    ) {
      setMounted(false);
    }
  }

  return { mounted: expanded || mounted, open: expanded && open, handleTransitionEnd };
}

function fixedCellClass<T>(col: ProColumnDef<T>, isHeader = false): string | undefined {
  if (col.fixed !== 'right') return undefined;
  return cn(
    'sticky right-0 z-[1] shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.12)] transition-colors',
    isHeader ? 'bg-muted' : 'bg-card group-hover:bg-table-row-hover',
  );
}

function getCellValue<T>(record: T, key: string): unknown {
  return (record as Record<string, unknown>)[key];
}

function ExpandButton({
  record,
  expanded,
  onClick,
  render,
}: {
  record: unknown;
  expanded: boolean;
  onClick: () => void;
  render?: (props: ProTableExpandButtonProps) => ReactNode;
}) {
  if (render) return <>{render({ record, expanded, onClick })}</>;

  return (
    <button
      type="button"
      aria-label={expanded ? '收起行' : '展开行'}
      aria-expanded={expanded}
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
    >
      <ChevronRight
        size={16}
        aria-hidden="true"
        className={`transition-transform duration-200 ease-out ${expanded ? 'rotate-90' : ''}`}
      />
    </button>
  );
}

/** 渲染桌面端数据行和可选的展开内容。 */
export function DesktopRows<T extends object>({
  record,
  rowKey,
  columns,
  index,
  expandable,
}: {
  record: T;
  rowKey: string;
  columns: ProColumnDef<T>[];
  index: number;
  expandable?: ProTableProps<T>['expandable'];
}) {
  const canExpand = Boolean(expandable && (expandable.isRowExpandable?.(record) ?? true));
  const hasExpandedContent = Boolean(
    canExpand && (expandable?.hasExpandedContent?.(record) ?? true),
  );
  const expanded = Boolean(canExpand && expandable?.expandedRowKeys.includes(rowKey));
  const expandAnimation = useExpandAnimation(expanded);
  const toggle = () => {
    if (!expandable || !canExpand) return;
    const next = expanded
      ? expandable.expandedRowKeys.filter((key) => key !== rowKey)
      : [...expandable.expandedRowKeys, rowKey];
    expandable.onExpandedChange(next);
  };
  return (
    <>
      <TableRow>
        {expandable && (
          <TableCell className={cn('w-11 px-2 text-center', expandable.columnClassName)}>
            {canExpand && (
              <ExpandButton
                record={record}
                expanded={expanded}
                onClick={toggle}
                render={expandable.renderExpandButton}
              />
            )}
          </TableCell>
        )}
        {columns.map((col) => (
          <TableCell key={col.key} className={cn(col.className, fixedCellClass(col))}>
            {col.render
              ? col.render(getCellValue(record, col.key), record, index)
              : (getCellValue(record, col.key) as ReactNode)}
          </TableCell>
        ))}
      </TableRow>
      {hasExpandedContent && expandAnimation.mounted && (
        <TableRow>
          <TableCell colSpan={columns.length + 1} className="bg-muted/10 p-0">
            <div
              className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-out ${
                expandAnimation.open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
              }`}
              onTransitionEnd={expandAnimation.handleTransitionEnd}
            >
              <div className="min-h-0 overflow-hidden">{expandable?.renderExpandedRow(record)}</div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/** 渲染移动端卡片和可选的展开内容。 */
export function MobileCard<T extends object>({
  record,
  columns,
  index,
  rowKey,
  expandable,
}: {
  record: T;
  columns: ProColumnDef<T>[];
  index: number;
  rowKey: string;
  expandable?: ProTableProps<T>['expandable'];
}) {
  const titleCol = columns.find((c) => c.cardTitle);
  const descCol = columns.find((c) => c.cardDesc);
  const tagCol = columns.find((c) => c.cardTag);
  const detailCols = columns.filter(
    (c) => !c.hideOnMobile && !c.cardTitle && !c.cardDesc && !c.cardTag,
  );
  const canExpand = Boolean(expandable && (expandable.isRowExpandable?.(record) ?? true));
  const hasExpandedContent = Boolean(
    canExpand && (expandable?.hasExpandedContent?.(record) ?? true),
  );
  const expanded = Boolean(canExpand && expandable?.expandedRowKeys.includes(rowKey));
  const expandAnimation = useExpandAnimation(expanded);
  const toggle = () => {
    if (!expandable || !canExpand) return;
    const next = expanded
      ? expandable.expandedRowKeys.filter((key) => key !== rowKey)
      : [...expandable.expandedRowKeys, rowKey];
    expandable.onExpandedChange(next);
  };

  return (
    <Card className="overflow-hidden transition-colors hover:bg-muted/20">
      <CardContent className="space-y-2.5 p-4">
        {canExpand && (
          <div className="-mb-1 flex justify-end">
            <ExpandButton
              record={record}
              expanded={expanded}
              onClick={toggle}
              render={expandable?.renderExpandButton}
            />
          </div>
        )}
        {(titleCol || tagCol) && (
          <div className="flex min-w-0 items-start justify-between gap-2">
            {titleCol && (
              <div className="min-w-0 flex-1 text-sm font-semibold text-foreground">
                {titleCol.render
                  ? titleCol.render(getCellValue(record, titleCol.key), record, index)
                  : (getCellValue(record, titleCol.key) as ReactNode)}
              </div>
            )}
            {tagCol && (
              <span className="max-w-[45%] shrink-0">
                {tagCol.render
                  ? tagCol.render(getCellValue(record, tagCol.key), record, index)
                  : (getCellValue(record, tagCol.key) as ReactNode)}
              </span>
            )}
          </div>
        )}
        {descCol && (
          <p className="text-xs text-muted-foreground">
            {descCol.render
              ? descCol.render(getCellValue(record, descCol.key), record, index)
              : (getCellValue(record, descCol.key) as ReactNode)}
          </p>
        )}
        {detailCols.length > 0 && (
          <div
            className={`grid gap-x-4 gap-y-2.5 pt-1 ${detailCols.length >= 3 ? 'grid-cols-2' : 'grid-cols-1'}`}
          >
            {detailCols.map((col) => (
              <div key={col.key} className="flex min-w-0 flex-col">
                <span className="text-[10px] font-medium text-muted-foreground/60">
                  {col.title}
                </span>
                <span className="min-w-0 break-words text-xs text-foreground/80">
                  {col.render
                    ? col.render(getCellValue(record, col.key), record, index)
                    : (getCellValue(record, col.key) as ReactNode)}
                </span>
              </div>
            ))}
          </div>
        )}
        {hasExpandedContent && expandAnimation.mounted && (
          <div className="border-t border-border/40 pt-3">
            <div
              className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-out ${
                expandAnimation.open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
              }`}
              onTransitionEnd={expandAnimation.handleTransitionEnd}
            >
              <div className="min-h-0 overflow-hidden">{expandable?.renderExpandedRow(record)}</div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** 渲染桌面端表格骨架屏。 */
export function TableSkeleton<T>({
  columns,
  rows,
  minWidth,
}: {
  columns: ProColumnDef<T>[];
  rows: number;
  minWidth?: number;
}) {
  return (
    <Table style={minWidth ? { minWidth } : undefined}>
      <TableHeader>
        <TableRow>
          {columns.map((col) => (
            <TableHead key={col.key}>
              <Skeleton className="h-4 w-16" />
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: rows }).map((_, i) => (
          <TableRow key={i}>
            {columns.map((col) => (
              <TableCell key={col.key}>
                <Skeleton className="h-4 w-full max-w-[120px]" />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** 渲染移动端卡片骨架屏。 */
export function MobileCardSkeleton({ rows }: { rows: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <Card key={i}>
          <CardContent className="space-y-3 p-4">
            <div className="flex justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-12 rounded-full" />
            </div>
            <Skeleton className="h-3 w-40" />
            <div className="grid grid-cols-2 gap-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          </CardContent>
        </Card>
      ))}
    </>
  );
}

/** 渲染 ProTable 的默认空状态。 */
export function EmptyState({ children }: { children?: ReactNode }) {
  if (children) return <>{children}</>;
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <svg
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-muted-foreground/20"
      >
        <path d="M21 9V6a2 2 0 00-2-2H5a2 2 0 00-2 2v3" />
        <path d="M3 16v3a2 2 0 002 2h14a2 2 0 002-2v-3" />
        <path d="M12 12v0" />
        <circle cx="12" cy="12" r="1" />
      </svg>
      <p className="mt-3 text-sm text-muted-foreground">暂无数据</p>
    </div>
  );
}
