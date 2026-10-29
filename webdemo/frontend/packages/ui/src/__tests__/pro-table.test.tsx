import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Badge } from '../components/ui/badge';
import { ProTable, type ProColumnDef } from '../components/ui/pro-table';

interface Row {
  id: string;
  title: string;
  status: string;
  gpu: number;
}

const rows: Row[] = [
  {
    id: 'job-1',
    title: 'Very long model evaluation task name that should stay inside the mobile card',
    status: '失败',
    gpu: 2,
  },
];

const columns: ProColumnDef<Row>[] = [
  { key: 'title', title: '任务', cardTitle: true },
  {
    key: 'status',
    title: '状态',
    cardTag: true,
    render: (_value, row) => <Badge variant="destructive">{row.status}</Badge>,
  },
  { key: 'gpu', title: 'GPU' },
];

describe('ProTable', () => {
  it('should constrain mobile card title so the tag is not pushed outside', () => {
    const { container, rerender } = render(
      <ProTable<Row> columns={columns} dataSource={rows} rowKey="id" forceMobile />,
    );

    const titles = screen.getAllByText(rows[0].title);
    const title = titles[titles.length - 1];
    const titleBox = title?.closest('.min-w-0.flex-1');
    const tagBox = Array.from(container.querySelectorAll('span')).find((node) =>
      node.className.includes('max-w-[45%]'),
    );

    expect(titleBox).toBeInTheDocument();
    expect(tagBox).toBeInTheDocument();
    expect(tagBox).toHaveClass('shrink-0');
  });

  it('should apply minWidth to the desktop table so wide column sets scroll horizontally', () => {
    const { container } = render(
      <ProTable<Row> columns={columns} dataSource={rows} rowKey="id" minWidth={1560} />,
    );

    expect(container.querySelector('table')).toHaveStyle({ minWidth: '1560px' });
  });

  it('should keep a fixed action cell visually aligned with the row hover state', () => {
    const fixedColumns: ProColumnDef<Row>[] = [
      ...columns,
      { key: 'action', title: '操作', fixed: 'right', className: 'w-24 min-w-24 whitespace-nowrap' },
    ];
    const { container } = render(
      <ProTable<Row>
        columns={fixedColumns}
        dataSource={rows}
        rowKey="id"
        minWidth={720}
      />,
    );

    expect(screen.getByRole('columnheader', { name: '操作' })).toHaveClass('sticky', 'bg-muted');
    expect(container.querySelector('tbody td:last-child')).toHaveClass(
      'sticky',
      'bg-card',
      'group-hover:bg-table-row-hover',
    );
  });

  it('should render and toggle an expandable row', () => {
    const onExpandedChange = vi.fn();
    const { container, rerender } = render(
      <ProTable<Row>
        columns={columns}
        dataSource={rows}
        rowKey="id"
        expandable={{
          expandedRowKeys: [],
          onExpandedChange,
          renderExpandedRow: (row) => <div>成员：{row.title}</div>,
        }}
      />,
    );

    const button = screen.getAllByRole('button', { name: '展开行' })[0]!;
    expect(screen.queryByText(`成员：${rows[0].title}`)).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(onExpandedChange).toHaveBeenCalledWith(['job-1']);

    rerender(
      <ProTable<Row>
        columns={columns}
        dataSource={rows}
        rowKey="id"
        expandable={{
          expandedRowKeys: ['job-1'],
          onExpandedChange,
          renderExpandedRow: (row) => <div>成员：{row.title}</div>,
        }}
      />,
    );
    expect(screen.getAllByText(`成员：${rows[0].title}`)).toHaveLength(2);
    expect(container).toBeTruthy();
  });

  it('should start the collapse animation in the same render as the expanded state change', () => {
    const { container, rerender } = render(
      <ProTable<Row>
        columns={columns}
        dataSource={rows}
        rowKey="id"
        expandable={{
          expandedRowKeys: ['job-1'],
          onExpandedChange: vi.fn(),
          renderExpandedRow: () => <div>成员列表</div>,
        }}
      />,
    );

    const expandedPanel = container.querySelector('td[colspan] > div');
    expect(expandedPanel).toHaveClass('grid-rows-[1fr]');

    rerender(
      <ProTable<Row>
        columns={columns}
        dataSource={rows}
        rowKey="id"
        expandable={{
          expandedRowKeys: [],
          onExpandedChange: vi.fn(),
          renderExpandedRow: () => <div>成员列表</div>,
        }}
      />,
    );

    expect(container.querySelector('td[colspan] > div')).toHaveClass('grid-rows-[0fr]');
  });

  it('should support a labeled custom expand control', () => {
    const { onExpandedChange } = { onExpandedChange: vi.fn() };
    render(
      <ProTable<Row>
        columns={columns}
        dataSource={rows}
        rowKey="id"
        expandable={{
          expandedRowKeys: [],
          onExpandedChange,
          columnTitle: '成员',
          columnClassName: 'min-w-24 w-24 whitespace-nowrap',
          renderExpandButton: ({ expanded, onClick }) => (
            <button type="button" aria-label={expanded ? '收起成员' : '展开成员'} onClick={onClick}>
              成员
            </button>
          ),
          renderExpandedRow: () => <div>成员列表</div>,
        }}
      />,
    );

    expect(screen.getByRole('columnheader', { name: '成员' })).toHaveClass('min-w-24', 'w-24');
    fireEvent.click(screen.getAllByRole('button', { name: '展开成员' })[0]!);
    expect(onExpandedChange).toHaveBeenCalledWith(['job-1']);
  });

  it('should hide the expand control for rows that are not expandable', () => {
    render(
      <ProTable<Row>
        columns={columns}
        dataSource={[rows[0]!, { ...rows[0]!, id: 'job-2', title: '不可展开的行' }]}
        rowKey="id"
        expandable={{
          expandedRowKeys: [],
          onExpandedChange: vi.fn(),
          isRowExpandable: (row) => row.id === 'job-1',
          renderExpandedRow: () => <div>成员列表</div>,
        }}
      />,
    );

    // ProTable keeps both the desktop and mobile DOM, and each renders one button only for expandable rows.
    expect(screen.getAllByRole('button', { name: '展开行' })).toHaveLength(2);
  });
});
