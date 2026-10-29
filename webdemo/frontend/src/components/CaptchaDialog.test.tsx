import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setApplicationLocale } from '@/i18n';
import { CaptchaDialog } from './CaptchaDialog';

vi.mock('@map/ui', () => ({
  Button: ({ children, ...props }: { children: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  SlideCaptcha: ({ title }: { title?: string }) => (
    <div data-testid="slide-captcha" data-title={title} />
  ),
}));

const challenge = {
  masterB64: 'background',
  tileB64: 'tile',
  tileX: 10,
  tileY: 20,
  tileWidth: 40,
  tileHeight: 40,
};

describe('CaptchaDialog', () => {
  beforeEach(async () => {
    await setApplicationLocale('en-US');
  });

  it('passes the active locale to the slider prompt', () => {
    render(
      <CaptchaDialog
        open
        challenge={challenge}
        loading={false}
        error={null}
        status="default"
        onConfirm={vi.fn()}
        onRefresh={vi.fn()}
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId('slide-captcha')).toHaveAttribute(
      'data-title',
      'Drag the slider to complete the puzzle',
    );
  });

  it('keeps the Chinese slider prompt for the Chinese deployment profile', async () => {
    await setApplicationLocale('zh-CN');

    render(
      <CaptchaDialog
        open
        challenge={challenge}
        loading={false}
        error={null}
        status="default"
        onConfirm={vi.fn()}
        onRefresh={vi.fn()}
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId('slide-captcha')).toHaveAttribute(
      'data-title',
      '向右拖动滑块完成拼图',
    );
  });
});
