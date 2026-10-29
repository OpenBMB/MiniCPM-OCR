import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ZoomIn } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import { ImageParseToolButton } from './ImageParseToolButton';

describe('文档工具图标提示', () => {
  it('悬停显示提示，点击回调及按下状态保持不变', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <ImageParseToolButton label="放大" hint="放大原图" onClick={onClick} pressed>
        <ZoomIn aria-hidden="true" />
      </ImageParseToolButton>,
    );
    const action = screen.getByRole('button', { name: '放大' });
    expect(action).toHaveAttribute('aria-pressed', 'true');
    await user.hover(action);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('放大原图');
    await user.click(action);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('禁用按钮仍能悬停查看提示，但不能执行操作', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <ImageParseToolButton label="放大" onClick={onClick} disabled>
        <ZoomIn aria-hidden="true" />
      </ImageParseToolButton>,
    );
    const action = screen.getByRole('button', { name: '放大' });
    expect(action).toBeDisabled();
    await user.hover(action.parentElement!);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('放大');
    fireEvent.click(action);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('键盘可聚焦禁用操作的提示入口', async () => {
    const user = userEvent.setup();
    render(
      <ImageParseToolButton label="缩小" onClick={vi.fn()} disabled>
        <ZoomIn aria-hidden="true" />
      </ImageParseToolButton>,
    );
    const action = screen.getByRole('button', { name: '缩小' });
    await user.tab();
    expect(action.parentElement).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('缩小');
    expect(action).toBeDisabled();
  });
});
