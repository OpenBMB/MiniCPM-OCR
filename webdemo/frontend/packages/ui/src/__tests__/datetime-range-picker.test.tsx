import userEvent from '@testing-library/user-event';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DateTimeRangePicker } from '../components/ui/datetime-range-picker';

describe('DateTimeRangePicker', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
  });

  it('点击全部后通知调用方选择全量时间范围', () => {
    const onChange = vi.fn();
    const onSelectAll = vi.fn();

    render(
      <DateTimeRangePicker
        ariaLabel="统计区间"
        start="2026-08-01 00:00:00"
        end="2026-08-16 23:59:59"
        onChange={onChange}
        onSelectAll={onSelectAll}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '统计区间' }));
    fireEvent.click(screen.getByRole('button', { name: '全部' }));

    expect(onSelectAll).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('允许直接输入完整日期时间区间并按回车提交', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <DateTimeRangePicker
        ariaLabel="统计区间"
        start="2026-08-01 00:00:00"
        end="2026-08-16 23:59:59"
        onChange={onChange}
      />,
    );

    const input = screen.getByRole('textbox', { name: '统计区间' }) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '2026-08-01 08:30:00 → 2026-08-28 18:45:00');
    await user.keyboard('{Enter}');

    expect(onChange).toHaveBeenCalledWith('2026-08-01 08:30:00', '2026-08-28 18:45:00');
  });

  it('date 模式只显示日期并按日期格式提交', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <DateTimeRangePicker
        mode="date"
        ariaLabel="统计区间"
        start="2026-08-01 00:00:00"
        end="2026-08-16 23:59:59"
        onChange={onChange}
      />,
    );

    const input = screen.getByRole('textbox', { name: '统计区间' }) as HTMLInputElement;
    expect(input).toHaveValue('2026-08-01  →  2026-08-16');

    await user.clear(input);
    await user.type(input, '2026-08-03 → 2026-08-10');
    await user.keyboard('{Enter}');

    expect(onChange).toHaveBeenCalledWith('2026-08-03', '2026-08-10');
    expect(input).toHaveValue('2026-08-03  →  2026-08-10');
  });

  it('输入无效区间时显示错误且不提交', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <DateTimeRangePicker
        ariaLabel="统计区间"
        start="2026-08-01 00:00:00"
        end="2026-08-16 23:59:59"
        onChange={onChange}
      />,
    );

    const input = screen.getByRole('textbox', { name: '统计区间' });
    await user.clear(input);
    await user.type(input, '2026-02-31 00:00:00 → 2026-02-28 23:59:59');
    await user.keyboard('{Enter}');

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('请输入有效的日期时间区间');
  });

  it('输入完整但不存在的日期时立即显示错误', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <DateTimeRangePicker
        ariaLabel="统计区间"
        start="2026-08-01 00:00:00"
        end="2026-08-16 23:59:59"
        onChange={onChange}
      />,
    );

    const input = screen.getByRole('textbox', { name: '统计区间' });
    await user.clear(input);
    await user.type(input, '2026-08-32 00:00:00 → 2026-08-28 23:59:59');

    expect(screen.getByRole('alert')).toHaveTextContent('请输入有效的日期时间区间');
    expect(input).toHaveValue('2026-08-32 00:00:00 → 2026-08-28 23:59:59');
    fireEvent.blur(input);
    expect(input).toHaveValue('2026-08-01 00:00:00  →  2026-08-16 23:59:59');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('点击日期输入框时打开选择浮层', async () => {
    const user = userEvent.setup();

    render(
      <DateTimeRangePicker
        ariaLabel="统计区间"
        start="2026-08-01 00:00:00"
        end="2026-08-16 23:59:59"
      />,
    );

    await user.click(screen.getByRole('textbox', { name: '统计区间' }));

    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('日期网格支持方向键移动并用回车选择', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <DateTimeRangePicker
        mode="date"
        ariaLabel="统计区间"
        start="2026-08-01"
        end="2026-08-16"
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: '统计区间' }));
    const augustFirst = document.querySelector<HTMLButtonElement>('[data-date="2026-7-1"]');
    expect(augustFirst).not.toBeNull();
    augustFirst?.focus();

    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(document.querySelector('[data-date="2026-7-8"]'));

    await user.keyboard('{Enter}');
    await user.keyboard('{ArrowRight}{ArrowRight}{Enter}');
    await user.click(screen.getByRole('button', { name: '确定' }));
    expect(onChange).toHaveBeenCalledWith('2026-08-08', '2026-08-10');
  });

  it('时间列支持上下键循环选择并保持当前选中项', async () => {
    const user = userEvent.setup();

    render(
      <DateTimeRangePicker
        ariaLabel="统计区间"
        start="2026-08-01 01:00:00"
        end="2026-08-16 23:59:59"
      />,
    );

    await user.click(screen.getByRole('button', { name: '统计区间' }));
    const hour = screen.getByRole('button', { name: '时 01' });

    await user.click(hour);
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: '时 02' })).toHaveAttribute('aria-current', 'true');
    expect(hour).toHaveAttribute('aria-current', 'false');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '时 02' }));

    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('button', { name: '时 01' })).toHaveAttribute('aria-current', 'true');
  });

  it('打开面板后输入框焦点也支持上下键调整当前时间列', async () => {
    const user = userEvent.setup();

    render(
      <DateTimeRangePicker
        ariaLabel="统计区间"
        start="2026-08-01 01:00:00"
        end="2026-08-16 23:59:59"
      />,
    );

    const input = screen.getByRole('textbox', { name: '统计区间' }) as HTMLInputElement;
    await user.click(input);
    input.setSelectionRange(11, 11);
    expect(document.activeElement).toBe(input);

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: '时 02' })).toHaveAttribute('aria-current', 'true');

    await user.keyboard('{ArrowUp}');
    expect(input).toHaveValue('2026-08-01 01:00:00  →  2026-08-16 23:59:59');
  });

  it('输入框上下键按光标所在的开始或结束时间字段递增递减', async () => {
    const user = userEvent.setup();

    render(
      <DateTimeRangePicker
        ariaLabel="统计区间"
        start="2026-08-01 01:02:03"
        end="2026-08-16 23:59:59"
      />,
    );

    const input = screen.getByRole('textbox', { name: '统计区间' }) as HTMLInputElement;
    await user.click(input);
    const endSecondsStart = input.value.length - 2;
    input.setSelectionRange(endSecondsStart, endSecondsStart);

    await user.keyboard('{ArrowUp}');

    expect(input).toHaveValue('2026-08-01 01:02:03  →  2026-08-16 23:59:58');
  });

  it('输入框上下键按光标所在的日期字段递增递减', async () => {
    const user = userEvent.setup();

    render(
      <DateTimeRangePicker
        ariaLabel="统计区间"
        start="2026-08-01 01:02:03"
        end="2026-08-16 23:59:59"
      />,
    );

    const input = screen.getByRole('textbox', { name: '统计区间' }) as HTMLInputElement;
    await user.click(input);

    input.setSelectionRange(5, 5);
    await user.keyboard('{ArrowUp}');
    expect(input).toHaveValue('2026-07-01 01:02:03  →  2026-08-16 23:59:59');

    input.setSelectionRange(8, 8);
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveValue('2026-07-02 01:02:03  →  2026-08-16 23:59:59');
  });
});
