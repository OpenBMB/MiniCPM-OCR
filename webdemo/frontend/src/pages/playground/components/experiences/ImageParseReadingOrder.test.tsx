import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@map/store';

import type { ImageParseLayoutBlock } from '../../utils/imageParseSample';
import { ImageParseBlocksOverlay } from './ImageParseBlocksOverlay';
import { ImageParseOrderToggle } from './ImageParseOrderToggle';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function block(
  order: number,
  label: string,
  extra: Partial<ImageParseLayoutBlock> = {},
): ImageParseLayoutBlock {
  return {
    id: `ocr-${order}`,
    order,
    label,
    kind: 'text',
    x: 0.1,
    y: order / 10,
    w: 0.5,
    h: 0.05,
    text: label,
    markdown: label,
    confidence: null,
    ...extra,
  };
}

const blocks = [
  block(0, 'header'),
  block(1, 'text'),
  // 跨栏合并块有两个区域：序号只标一次
  block(2, 'table', {
    regions: [
      { x: 0.1, y: 0.3, w: 0.3, h: 0.1 },
      { x: 0.5, y: 0.3, w: 0.3, h: 0.1 },
    ],
  }),
];

const setOrder = (value: boolean) =>
  useAppStore.getState().setPlaygroundPrefs({ imageParseShowOrder: value });

describe('版面阅读顺序', () => {
  beforeEach(() => setOrder(true));

  it('开启时每个块标一次序号，后端 order + 1', () => {
    const { container } = render(<ImageParseBlocksOverlay blocks={blocks} onSelect={vi.fn()} />);
    const badges = [...container.querySelectorAll('[data-block-order]')].map(
      (el) => el.textContent,
    );
    expect(badges).toEqual(['1', '2', '3']);
    expect(container.querySelector('[data-origin-block-id="ocr-2"]')).toHaveAttribute(
      'title',
      '#3 table',
    );
  });

  it('开启时没有分数的框也画出边框', () => {
    const { container } = render(<ImageParseBlocksOverlay blocks={blocks} onSelect={vi.fn()} />);
    const box = container.querySelector('[data-origin-block-id="ocr-1"]')!;
    expect(box.className).not.toContain('after:invisible');
  });

  it('关闭阅读顺序时仅移除序号，保留统一识别框', () => {
    setOrder(false);
    const { container } = render(<ImageParseBlocksOverlay blocks={blocks} onSelect={vi.fn()} />);
    expect(container.querySelector('[data-block-order]')).toBeNull();
    expect(container.querySelector('[data-origin-block-id="ocr-1"]')!.className).not.toContain(
      'after:invisible',
    );
  });

  it('开关写入持久化偏好', async () => {
    render(<ImageParseOrderToggle />);
    const button = screen.getByRole('button', { name: 'imageParseHideOrder' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(button);
    expect(useAppStore.getState().playground.imageParseShowOrder).toBe(false);
    expect(screen.getByRole('button', { name: 'imageParseShowOrder' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('识别框隐藏时开关禁用', () => {
    render(<ImageParseOrderToggle disabled />);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
