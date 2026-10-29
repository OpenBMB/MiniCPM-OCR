import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ImageParseResultActions } from './ImageParseResultActions';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('结果级操作入口', () => {
  it('只保留导出命令，不重复展示 Markdown 视图入口', async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();
    render(<ImageParseResultActions loading={false} onDownload={onDownload} />);
    expect(screen.queryByRole('button', { name: 'imageParseQualityShowMarkdown' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'copy' })).toBeNull();
    const download = screen.getByRole('button', { name: 'imageParseDownload' });
    expect(download).toHaveTextContent('imageParseDownload');
    await user.click(download);
    expect(onDownload).not.toHaveBeenCalled();
    await user.click(screen.getByRole('menuitem', { name: 'Markdown .md' }));
    expect(onDownload).toHaveBeenCalledExactlyOnceWith('markdown');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it.each([
    ['JSON .json', 'json'],
    ['Word .docx', 'word'],
  ])('提供 %s 下载格式', async (label, format) => {
    const user = userEvent.setup();
    const onDownload = vi.fn();
    render(<ImageParseResultActions loading={false} onDownload={onDownload} />);
    await user.click(screen.getByRole('button', { name: 'imageParseDownload' }));
    await user.click(screen.getByRole('menuitem', { name: label }));
    expect(onDownload).toHaveBeenCalledExactlyOnceWith(format);
  });

  it('键盘可打开菜单、选择格式，Esc 关闭并恢复焦点', async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();
    render(<ImageParseResultActions loading={false} onDownload={onDownload} />);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menuitem', { name: 'Markdown .md' })).toHaveFocus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onDownload).toHaveBeenCalledExactlyOnceWith('json');
    await user.keyboard('{Enter}');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: 'imageParseDownload' })).toHaveFocus();
  });

  it('生成文件时禁止重复下载', () => {
    render(<ImageParseResultActions loading={false} downloading onDownload={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'imageParseDownload' })).toBeDisabled();
  });

  it('键盘选择下载后，文件生成完成时恢复触发器焦点', async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();
    const { rerender } = render(
      <ImageParseResultActions loading={false} onDownload={onDownload} />,
    );
    onDownload.mockImplementation(() =>
      rerender(<ImageParseResultActions loading={false} downloading onDownload={onDownload} />),
    );
    await user.tab();
    await user.keyboard('{Enter}{ArrowDown}{ArrowDown}{Enter}');
    expect(onDownload).toHaveBeenCalledExactlyOnceWith('word');
    expect(screen.getByRole('button', { name: 'imageParseDownload' })).toBeDisabled();
    rerender(<ImageParseResultActions loading={false} onDownload={onDownload} />);
    expect(screen.getByRole('button', { name: 'imageParseDownload' })).toHaveFocus();
  });

  it('识别期间禁止导出', () => {
    const onDownload = vi.fn();
    render(<ImageParseResultActions loading onDownload={onDownload} />);
    expect(screen.getByRole('button', { name: 'imageParseDownload' })).toBeDisabled();
  });

});
