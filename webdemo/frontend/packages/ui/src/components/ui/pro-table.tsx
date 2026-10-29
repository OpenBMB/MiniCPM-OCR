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
  /** 固定到右侧：横向滚动时该列（通常是「操作」列）保持可见，常配 text-right 使用。 */
  fixed?: 'right';
  cardTitle?: boolean;
  cardDesc?: boolean;
  cardTag?: boolean;
}

/** 右固定列的粘性样式：吸附右侧、盖住下层内容，左侧加细阴影提示可滚动。
 *  背景需与所在行一致——表头用 bg-muted（同表头底色），表体用 bg-card——否则固定列底色会突兀。 */
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
  /** 每页条数选项；缺省沿用 Pagination 的默认选项。 */
  pageSizeOptions?: number[];
  /** 是否展示每页条数选择器；默认 true。 */
  showSizeChanger?: boolean;
  /** 是否展示快捷跳页；默认 true。 */
  showQuickJump?: boolean;
  /** 是否展示页码按钮；默认 true。 */
  showPageNumbers?: boolean;
}

/** ProTable 展开按钮渲染参数。 */
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
  /** 顶部裸工具栏（不带卡片背景），用于标题/按钮等。与 filters 互斥使用，优先用 filters。 */
  toolbar?: ReactNode;
  /**
   * 筛选区：渲染为独立的「筛选卡片」置于表格卡片上方（两段式排版）。
   * 传入筛选控件（搜索框 + 下拉 + 动作按钮）即可获得统一的「筛选卡片 + 表格卡片」布局。
   */
  filters?: ReactNode;
  /** 结果卡片头部右侧插槽：放视图切换、导出等动作。 */
  tableHeader?: ReactNode;
  /** 结果总数：显式传入则在结果卡片头部展示「共 N 条」；缺省时回退到 pagination.total。 */
  total?: number;
  /** 计数名词，拼在「共 N 条」之后，如「数据集」「调用」。 */
  countNoun?: string;
  /** 是否展示「共 N 条」计数（默认 true）。分页总数为估算值时可关闭，避免误导。 */
  showCount?: boolean;
  empty?: ReactNode;
  className?: string;
  /**
   * 桌面端表格最小宽度（px）：列多时给足固定宽度，超出容器即横向滚动，
   * 避免列被压缩成多行折行。缺省则表格自适应容器宽度（原行为）。
   */
  minWidth?: number;
  skeletonRows?: number;
  forceMobile?: boolean;
  /** 桌面端是否填满所在网格行高度，并将分页器贴到底部。 */
  fillHeight?: boolean;
  pagination?: ProTablePagination | false;
  /** 可选展开行：展开内容由业务页按行提供，展开状态由业务页管理。 */
  expandable?: {
    expandedRowKeys: string[];
    onExpandedChange: (keys: string[]) => void;
    renderExpandedRow: (record: T) => ReactNode;
    /** 展开控制列的表头文案，默认不显示。 */
    columnTitle?: string;
    /** 展开控制列的附加样式，适用于带文字的展开控件。 */
    columnClassName?: string;
    /** 按行控制是否显示展开按钮；不可展开的行仍保留空白控制列以保持表格对齐。 */
    isRowExpandable?: (record: T) => boolean;
    /** 按行控制展开后是否渲染详情内容；可用于将展开状态复用于树形数据。 */
    hasExpandedContent?: (record: T) => boolean;
    /** 自定义展开按钮，用于区分不同展开语义。 */
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
