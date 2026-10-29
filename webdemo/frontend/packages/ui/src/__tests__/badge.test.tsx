import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from '../components/ui/badge';

describe('Badge', () => {
  it('should render success variant with soft semantic fill', () => {
    render(<Badge variant="success">已完成</Badge>);
    const badge = screen.getByText('已完成');
    expect(badge.className).toContain('bg-success/15');
    expect(badge.className).toContain('text-success');
  });

  it('should render info variant with soft semantic fill for running state', () => {
    render(<Badge variant="info">运行中</Badge>);
    const badge = screen.getByText('运行中');
    expect(badge.className).toContain('bg-info/15');
    expect(badge.className).toContain('text-info');
  });

  it('should render destructive variant with soft semantic fill', () => {
    render(<Badge variant="destructive">失败</Badge>);
    const badge = screen.getByText('失败');
    expect(badge.className).toContain('bg-destructive/15');
    expect(badge.className).toContain('text-destructive');
    expect(badge.className).not.toContain('text-destructive-foreground');
  });
});
