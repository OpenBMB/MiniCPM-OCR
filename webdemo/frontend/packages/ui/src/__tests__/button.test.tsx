import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '../components/ui/button';

describe('Button', () => {
  it('应渲染按钮文本', () => {
    render(<Button>提交</Button>);
    expect(screen.getByRole('button', { name: '提交' })).toBeInTheDocument();
  });

  it('应应用 variant class', () => {
    render(<Button variant="destructive">删除</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('bg-destructive');
  });

  it('应应用 size class', () => {
    render(<Button size="sm">小按钮</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('h-7');
  });

  it('disabled 状态应阻止点击', async () => {
    const user = userEvent.setup();
    let clicked = false;
    render(
      <Button
        disabled
        onClick={() => {
          clicked = true;
        }}
      >
        禁用
      </Button>,
    );

    await user.click(screen.getByRole('button'));
    expect(clicked).toBe(false);
  });

  it('asChild 应渲染为子元素标签', () => {
    render(
      <Button asChild>
        <a href="/link">链接按钮</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: '链接按钮' });
    expect(link).toBeInTheDocument();
    expect(link.tagName).toBe('A');
  });
});
