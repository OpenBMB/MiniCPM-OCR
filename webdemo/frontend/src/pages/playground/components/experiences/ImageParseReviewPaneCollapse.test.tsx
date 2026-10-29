import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ImageParseReviewPane } from './ImageParseReviewPane';
import { imageParseQuality } from '../../utils/imageParseQuality';
import { IMAGE_PARSE_SAMPLE_BLOCKS } from '../../utils/__tests__/imageParseSampleFixtures';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const original = {
  ...IMAGE_PARSE_SAMPLE_BLOCKS[2],
  id: 'first',
  text: '原文 99',
  markdown: '原文 99',
  confidence: 0.4,
};
const best = { ...original, text: '新文 996', markdown: '新文 996', confidence: 0.9 };
const props = {
  quality: imageParseQuality([best]),
  dirty: false,
  loading: false,
  ranges: new Map([['first', { start: 0, end: 5 }]]),
  results: { first: { original, best, improved: true, rounds: 1 } },
  all: false,
  limit: 40,
  onLoadMore: vi.fn(),
};

describe('复核卡片头部折叠', () => {
  it('点击头部可收起再展开，保留定位且与箭头状态同步', () => {
    const onSelectBlock = vi.fn();
    const { container } = render(
      <ImageParseReviewPane {...props} onSelectBlock={onSelectBlock} onRegenerateBlock={vi.fn()} />,
    );
    const header = container.querySelector('[data-review-block-id="first"]')!;
    expect(header).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'imageParseBestVersion' })).toBeNull();
    expect(screen.getByRole('button', { name: 'imageParseComparisonExpand' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'imageParseBestVersion' })).toBeVisible();
    expect(onSelectBlock).toHaveBeenCalledTimes(2);
    expect(onSelectBlock).toHaveBeenLastCalledWith('first');
    fireEvent.click(screen.getByRole('button', { name: 'imageParseComparisonCollapse' }));
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(onSelectBlock).toHaveBeenCalledTimes(2);
  });

  it('没有右侧操作时也可用键盘收起、展开', async () => {
    const user = userEvent.setup();
    const { container } = render(<ImageParseReviewPane {...props} />);
    const header = container.querySelector<HTMLButtonElement>('[data-review-block-id="first"]')!;
    header.focus();
    await user.keyboard('{Enter}');
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'imageParseBestVersion' })).toBeNull();
    await user.keyboard(' ');
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'imageParseBestVersion' })).toBeVisible();
  });

  it('只折叠当前卡片，未复核条目的重生成不触发头部操作', () => {
    const second = { ...original, id: 'second' };
    const onSelectBlock = vi.fn();
    const onRegenerateBlock = vi.fn();
    const { container } = render(
      <ImageParseReviewPane
        {...props}
        quality={imageParseQuality([best, second])}
        ranges={new Map([...props.ranges, ['second', { start: 5, end: 10 }]])}
        onSelectBlock={onSelectBlock}
        regenerationAvailable
        onRegenerateBlock={onRegenerateBlock}
      />,
    );
    const headers = container.querySelectorAll('[data-review-block-id]');
    const first = container.querySelector('[data-review-block-id="first"]')!;
    const secondHeader = container.querySelector('[data-review-block-id="second"]')!;
    expect(headers).toHaveLength(2);
    expect(secondHeader).not.toHaveAttribute('aria-expanded');
    fireEvent.click(secondHeader);
    expect(first).toHaveAttribute('aria-expanded', 'true');
    onSelectBlock.mockClear();
    const secondCard = secondHeader.closest('[data-review-item]')!;
    fireEvent.click(secondCard.querySelector('[aria-label="imageParseRegenerateBlock"]')!);
    expect(onRegenerateBlock).toHaveBeenCalledWith('second');
    expect(onSelectBlock).not.toHaveBeenCalled();
    expect(first).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(secondHeader).not.toHaveAttribute('aria-expanded');
  });
});
