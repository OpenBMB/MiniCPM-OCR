import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@map/store';

import { ImageParseBlocksOverlay } from './ImageParseBlocksOverlay';
import type { ImageParseLayoutBlock } from '../../utils/imageParseSample';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { number?: number }) =>
      key === 'imageParseBlockNumber' ? `块 ${options?.number}` : key,
  }),
}));

const block: ImageParseLayoutBlock = {
  id: 'table',
  order: 2,
  kind: 'table',
  x: 0.1,
  y: 0.2,
  w: 0.8,
  h: 0.5,
  text: '表格正文',
  markdown: '表格正文',
  confidence: 0.92,
};

describe('原图识别框', () => {
  beforeEach(() => useAppStore.getState().setPlaygroundPrefs({ imageParseShowOrder: false }));

  it.each([null, 0, 0.5, 0.99, 1, Number.NaN])(
    '历史分数 %s 不再显示百分比或改变框线样式',
    (confidence) => {
      const { container } = render(
        <ImageParseBlocksOverlay blocks={[{ ...block, confidence }]} onSelect={vi.fn()} />,
      );
      const button = screen.getByRole('button', { name: '块 3' });
      expect(button).toHaveClass('border-border/60');
      expect(button).not.toHaveClass('after:invisible');
      expect(button.className).not.toContain('confidence');
      expect(container.querySelector('[data-block-score]')).toBeNull();
      expect(container.textContent).not.toContain('%');
    },
  );

  it('合并区块保留全部区域和原始坐标，不展示分数', async () => {
    const onSelect = vi.fn();
    const { container } = render(
      <ImageParseBlocksOverlay
        blocks={[
          {
            ...block,
            ttsInvalid: true,
            regions: [
              { x: 0.1, y: 0.2, w: 0.2, h: 0.3 },
              { x: 0.6, y: 0.2, w: 0.2, h: 0.3 },
            ],
          },
        ]}
        onSelect={onSelect}
      />,
    );
    const buttons = screen.getAllByRole('button', { name: '块 3' });
    expect(buttons).toHaveLength(2);
    expect(buttons[0].parentElement).toHaveStyle({
      left: '10%',
      top: '20%',
      width: '20%',
      height: '30%',
    });
    expect(buttons[1].parentElement).toHaveStyle({
      left: '60%',
      top: '20%',
      width: '20%',
      height: '30%',
    });
    expect(container.querySelector('[data-block-score]')).toBeNull();
    await userEvent.click(buttons[1]);
    expect(onSelect).toHaveBeenCalledWith('table');
  });

  it('悬停联动使用主题色，移出后恢复统一框线', () => {
    const props = { blocks: [block], onSelect: vi.fn() };
    const { rerender } = render(<ImageParseBlocksOverlay {...props} />);
    const button = screen.getByRole('button', { name: '块 3' });
    expect(button).toHaveClass('border-border/60', 'bg-transparent');
    rerender(<ImageParseBlocksOverlay {...props} hoveredBlockId="table" />);
    expect(button).toHaveClass('border-primary', 'text-primary', 'bg-primary/10');
    expect(button).toHaveAttribute('data-origin-highlight', 'true');
    rerender(<ImageParseBlocksOverlay {...props} />);
    expect(button).not.toHaveClass('bg-primary/10');
    expect(button).not.toHaveAttribute('data-origin-highlight');
  });

  it('没有分数的区块仍支持键盘定位与选中联动', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const props = { blocks: [{ ...block, confidence: null }], onSelect };
    const { rerender } = render(<ImageParseBlocksOverlay {...props} />);
    const button = screen.getByRole('button', { name: '块 3' });
    await user.tab();
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('table');
    rerender(<ImageParseBlocksOverlay {...props} selectedBlockId="table" linkedHighlight />);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveClass('border-primary', 'bg-primary/10');
    expect(button).toHaveAttribute('data-origin-highlight', 'true');
  });

  it('框内悬停和焦点继续触发联动回调', async () => {
    const onHoverBlock = vi.fn();
    render(
      <ImageParseBlocksOverlay blocks={[block]} onSelect={vi.fn()} onHoverBlock={onHoverBlock} />,
    );
    const button = screen.getByRole('button', { name: '块 3' });
    await userEvent.hover(button);
    expect(onHoverBlock).toHaveBeenLastCalledWith('table');
    await userEvent.unhover(button);
    expect(onHoverBlock).toHaveBeenLastCalledWith(undefined);
  });
});
