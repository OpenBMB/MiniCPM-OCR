import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ImageParsePageRail } from './ImageParsePageRail';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { page?: number; count?: number }) =>
      `${key}${values?.page ? ` ${values.page}` : ''}${values?.count ? ` ${values.count}` : ''}`,
  }),
}));

const pages = [
  { pageNumber: 1, preview: <img src="/first.png" alt="" /> },
  { pageNumber: 2, preview: <img src="/second.png" alt="" /> },
];

describe('原件页面导航', () => {
  it('展示各页缩略图和当前页，点击或键盘可切页', async () => {
    const onPageChange = vi.fn();
    render(<ImageParsePageRail pages={pages} page={1} onPageChange={onPageChange} />);
    const nav = screen.getByRole('navigation', { name: 'imageParsePages' });
    const first = within(nav).getByRole('button', { name: 'imageParseGoToPage 1' });
    const second = within(nav).getByRole('button', { name: 'imageParseGoToPage 2' });
    expect(first).toHaveAttribute('aria-current', 'page');
    expect(second).not.toHaveAttribute('aria-current');
    expect(first.querySelector('img')).toHaveAttribute('src', '/first.png');
    await userEvent.click(second);
    expect(onPageChange).toHaveBeenCalledWith(2);
    first.focus();
    await userEvent.keyboard('{Enter}');
    expect(onPageChange).toHaveBeenLastCalledWith(1);
  });

  it('添加入口属于页面列表，选择多张图片后重置选择器，取消不追加', async () => {
    const onAppendPages = vi.fn();
    render(
      <ImageParsePageRail
        pages={pages}
        page={1}
        onPageChange={vi.fn()}
        onAppendPages={onAppendPages}
      />,
    );
    const input = screen.getByLabelText('imageParseAddPages', { selector: 'input' });
    const click = vi.spyOn(input, 'click');
    await userEvent.click(screen.getByRole('button', { name: 'imageParseAddPages' }));
    expect(click).toHaveBeenCalledOnce();
    expect(input).toHaveAttribute('multiple');
    expect(input.getAttribute('accept')).toContain('application/pdf');
    fireEvent.change(input, { target: { files: [] } });
    expect(onAppendPages).not.toHaveBeenCalled();
    const files = [new File(['png'], 'extra.png', { type: 'image/png' })];
    fireEvent.change(input, { target: { files } });
    expect(onAppendPages).toHaveBeenCalledWith(files);
    expect(input).toHaveValue('');
  });

  it('识别或上传期间不能追加，但仍可浏览页面', () => {
    const { rerender } = render(
      <ImageParsePageRail pages={pages} page={1} onAppendPages={vi.fn()} disabled />,
    );
    expect(screen.getByRole('button', { name: 'imageParseAddPages' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'imageParseGoToPage 2' })).toBeEnabled();
    rerender(<ImageParsePageRail pages={pages} page={1} onAppendPages={vi.fn()} appending />);
    expect(screen.getByRole('button', { name: 'imageParseAddingPages' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('imageParseAddingPages');
  });
});
