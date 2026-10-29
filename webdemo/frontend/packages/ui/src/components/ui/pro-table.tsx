import { type ReactNode } from 'react';
import { cn } from '../../utils';
import { Card, CardContent } from './card';
import { Table, TableBody, TableHead, TableHeader, TableRow } from './table';
import { Pagination } from './pagination';
import {
  DesktopRows,
  EmptyState,
  MobileCard,
  MobileCardSkeleton,
  TableSkeleton,
} from './pro-table-parts';

/* ---- Column definition ---- */

export interface ProColumnDef<T> {
  key: string;
  title: string;
  render?: (value: unknown, record: T, index: number) => ReactNode;
  className?: string;
  hideOnMobile?: boolean;
  /** Pin to the right: this column (usually the "Actions" column) stays visible while scrolling horizontally, often with text-right. */
  fixed?: 'right';
  cardTitle?: boolean;
  cardDesc?: boolean;
  cardTag?: boolean;
}

/** Sticky styles for a right-pinned column: stick to the right, cover content underneath, and add a thin shadow on the left to show that it can scroll.
 *  The background must match the row — bg-muted on the header (same as the header fill), bg-card on the body — or the pinned column’s fill looks out of place. */
function fixedCellClass<T>(col: ProColumnDef<T>, isHeader = false): string | undefined {
  if (col.fixed !== 'right') return undefined;
  return cn(
    'sticky right-0 z-[1] shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.12)] transition-colors',
    isHeader ? 'bg-muted' : 'bg-card group-hover:bg-table-row-hover',
  );
}

/* ---- Pagination config ---- */

export interface ProTablePagination {
  current: number;
  pageSize: number;
  total: number;
  onChange?: (page: number, pageSize: number) => void;
  /** Page-size options; when omitted, Pagination’s defaults are used. */
  pageSizeOptions?: number[];
  /** Whether to show the page-size selector; default true. */
  showSizeChanger?: boolean;
  /** Whether to show the quick page jump; default true. */
  showQuickJump?: boolean;
  /** Whether to show page-number buttons; default true. */
  showPageNumbers?: boolean;
}

/** Render props for a ProTable expand button. */
export interface ProTableExpandButtonProps {
  record: unknown;
  expanded: boolean;
  onClick: () => void;
}

/* ---- ProTable props ---- */

export interface ProTableProps<T extends object> {
  columns: ProColumnDef<T>[];
  dataSource: T[];
  rowKey: keyof T | ((record: T) => string);
  loading?: boolean;
  /** Bare toolbar at the top (no card background), for a title, buttons, and similar. Mutually exclusive with filters; prefer filters. */
  toolbar?: ReactNode;
  /**
   * Filter region: rendered as its own "filter card" above the table card (two-part layout).
   * Pass filter controls (search box, dropdowns, and action buttons) to get the shared "filter card + table card" layout.
   */
  filters?: ReactNode;
  /** Right slot in the result-card header: view switches, export, and similar actions. */
  tableHeader?: ReactNode;
  /** Result total: when passed explicitly, the result-card header shows "N total"; otherwise it falls back to pagination.total. */
  total?: number;
  /** Count noun appended after "N total", for example "datasets" or "calls". */
  countNoun?: string;
  /** Whether to show the "N total" count (default true). Turn it off when the page total is an estimate, so it does not mislead. */
  showCount?: boolean;
  empty?: ReactNode;
  className?: string;
  /**
   * Minimum desktop table width (px): when there are many columns, give them a fixed width and scroll horizontally past the container,
   * instead of squeezing columns into wrapped lines. When omitted, the table sizes to the container (previous behavior).
   */
  minWidth?: number;
  skeletonRows?: number;
  forceMobile?: boolean;
  /** On desktop, fill the grid row height and pin the paginator to the bottom. */
  fillHeight?: boolean;
  pagination?: ProTablePagination | false;
  /** Optional expandable rows: the page supplies expanded content per row and owns the expanded state. */
  expandable?: {
    expandedRowKeys: string[];
    onExpandedChange: (keys: string[]) => void;
    renderExpandedRow: (record: T) => ReactNode;
    /** Header copy for the expand-control column; hidden by default. */
    columnTitle?: string;
    /** Extra styles for the expand-control column, for expand controls that include text. */
    columnClassName?: string;
    /** Per row, whether to show the expand button; rows that cannot expand still keep a blank control cell so the table stays aligned. */
    isRowExpandable?: (record: T) => boolean;
    /** Per row, whether expanded state renders detail content; the expanded state can also be reused for tree data. */
    hasExpandedContent?: (record: T) => boolean;
    /** Custom expand button, to distinguish different expand meanings. */
    renderExpandButton?: (props: ProTableExpandButtonProps) => ReactNode;
  };
}

function getRowKey<T extends object>(record: T, rowKey: keyof T | ((record: T) => string)): string {
  return typeof rowKey === 'function' ? rowKey(record) : String(record[rowKey]);
}

/* ---- Main component ---- */

function ProTable<T extends object>({
  columns,
  dataSource,
  rowKey,
  loading,
  toolbar,
  filters,
  tableHeader,
  total,
  countNoun,
  showCount = true,
  empty,
  className,
  minWidth,
  skeletonRows = 3,
  forceMobile,
  fillHeight = false,
  pagination,
  expandable,
}: ProTableProps<T>) {
  const isEmpty = !loading && dataSource.length === 0;

  let desktopMain: ReactNode;
  if (loading) {
    desktopMain = <TableSkeleton columns={columns} rows={skeletonRows} minWidth={minWidth} />;
  } else if (isEmpty) {
    desktopMain = <EmptyState>{empty}</EmptyState>;
  } else {
    desktopMain = (
      <div className="overflow-x-auto">
        <Table style={minWidth ? { minWidth } : undefined}>
          <TableHeader>
            <TableRow>
              {expandable && (
                <TableHead className={cn('w-11 px-2 text-center', expandable.columnClassName)}>
                  {expandable.columnTitle ?? ''}
                </TableHead>
              )}
              {columns.map((col) => (
                <TableHead key={col.key} className={cn(col.className, fixedCellClass(col, true))}>
                  {col.title}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {dataSource.map((record, idx) => (
              <DesktopRows
                key={getRowKey(record, rowKey)}
                record={record}
                rowKey={getRowKey(record, rowKey)}
                columns={columns}
                index={idx}
                expandable={expandable}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  let mobileMain: ReactNode;
  if (loading) {
    mobileMain = <MobileCardSkeleton rows={skeletonRows} />;
  } else if (isEmpty) {
    mobileMain = (
      <Card>
        <CardContent className="p-6">
          <EmptyState>{empty}</EmptyState>
        </CardContent>
      </Card>
    );
  } else {
    mobileMain = dataSource.map((record, idx) => (
      <MobileCard
        key={getRowKey(record, rowKey)}
        record={record}
        columns={columns}
        index={idx}
        rowKey={getRowKey(record, rowKey)}
        expandable={expandable}
      />
    ));
  }

  const showPagination = pagination && pagination.total > 0;
  const resolvedTotal = !showCount
    ? undefined
    : (total ?? (pagination ? pagination.total : undefined));
  const hasResultsHeader = resolvedTotal !== undefined || Boolean(tableHeader);
  const resultsHeader = hasResultsHeader ? (
    <div className="flex items-center justify-between gap-2 px-4 py-3">
      {resolvedTotal !== undefined ? (
        <span className="text-sm text-muted-foreground">
          共 <span className="font-semibold tabular-nums text-foreground">{resolvedTotal}</span> 条
          {countNoun}
        </span>
      ) : (
        <span />
      )}
      {tableHeader && <div className="flex items-center gap-2">{tableHeader}</div>}
    </div>
  ) : null;

  return (
    <div className={cn('space-y-3', fillHeight && 'md:h-full', className)}>
      {toolbar && (
        <div className="flex flex-wrap items-center justify-between gap-2">{toolbar}</div>
      )}
      {filters && (
        <Card>
          <CardContent className="p-4">{filters}</CardContent>
        </Card>
      )}
      <div className={cn(forceMobile ? 'hidden' : 'hidden md:block', fillHeight && 'md:h-full')}>
        <Card className={cn('overflow-hidden', fillHeight && 'md:h-full')}>
          <CardContent className={cn('p-0', fillHeight && 'flex md:h-full md:flex-col')}>
            {resultsHeader && <div className="border-b border-border/40">{resultsHeader}</div>}
            <div className={fillHeight ? 'min-h-0 md:flex-1' : undefined}>{desktopMain}</div>
            {showPagination && (
              <div className="border-t border-border/40 px-4 py-3">
                <Pagination
                  current={pagination.current}
                  pageSize={pagination.pageSize}
                  total={pagination.total}
                  onChange={pagination.onChange}
                  pageSizeOptions={pagination.pageSizeOptions}
                  showSizeChanger={pagination.showSizeChanger}
                  showQuickJump={pagination.showQuickJump}
                  showPageNumbers={pagination.showPageNumbers}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <div className={forceMobile ? 'block space-y-2' : 'block space-y-2 md:hidden'}>
        {resultsHeader && (
          <Card>
            <CardContent className="p-0">{resultsHeader}</CardContent>
          </Card>
        )}
        {mobileMain}
        {showPagination && (
          <div className="pt-2">
            <Pagination
              current={pagination.current}
              pageSize={pagination.pageSize}
              total={pagination.total}
              onChange={pagination.onChange}
              pageSizeOptions={pagination.pageSizeOptions}
              showSizeChanger={pagination.showSizeChanger}
              showQuickJump={pagination.showQuickJump}
              showPageNumbers={pagination.showPageNumbers}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export { ProTable };
