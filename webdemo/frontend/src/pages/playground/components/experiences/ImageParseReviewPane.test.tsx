import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ImageParseReviewPane } from './ImageParseReviewPane';
import { imageParseQuality } from '../../utils/imageParseQuality';
import { IMAGE_PARSE_SAMPLE_BLOCKS } from '../../utils/__tests__/imageParseSampleFixtures';
import { playgroundMessages } from '@/i18n/messages/playground';
import { WORKSPACE_ICON_CONTROL } from '../../utils/imageParseWorkspaceStyles';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => {
      if (key === 'imageParseRegenerateAll') return playgroundMessages['zh-CN'][key];
      if (key === 'imageParseRegenerating') return playgroundMessages['zh-CN'][key];
      if (key.endsWith('Count') || key.endsWith('Label') || key === 'imageParseQualitySuggested') {
        const text = playgroundMessages['zh-CN'][key as keyof (typeof playgroundMessages)['zh-CN']];
        return typeof text === 'string' ? text.replace('{{count}}', String(options?.count)) : key;
      }
      return key;
    },
  }),
}));

describe('块复核列表边界', () => {
  const props = {
    dirty: false,
    loading: false,
    ranges: new Map(),
    all: false,
    limit: 40,
    onLoadMore: vi.fn(),
  };
  it('正文按顶栏提供的分页展示，不再重复显示批量操作和筛选', () => {
    const quality = imageParseQuality(
      Array.from({ length: 45 }, (_, order) => ({
        ...IMAGE_PARSE_SAMPLE_BLOCKS[2],
        id: `low-${order}`,
        order,
        confidence: 0.4,
      })),
    );
    const onLoadMore = vi.fn();
    const { container, rerender } = render(
      <ImageParseReviewPane {...props} quality={quality} onLoadMore={onLoadMore} />,
    );
    expect(container.querySelectorAll('[data-review-block-id]')).toHaveLength(40);
    fireEvent.click(screen.getByRole('button', { name: 'loadMore' }));
    expect(onLoadMore).toHaveBeenCalledOnce();
    rerender(<ImageParseReviewPane {...props} quality={quality} limit={80} />);
    expect(container.querySelectorAll('[data-review-block-id]')).toHaveLength(45);
    expect(screen.queryByRole('button', { name: '一键重生成' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'imageParseQualityAll' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'loadMore' })).toBeNull();
    expect(
      screen.getAllByText('imageParseReview').every((label) => label.classList.contains('sr-only')),
    ).toBe(true);
  });

  it('可重生成条目保留单块操作，正文不占用额外操作行', () => {
    const { container } = render(
      <ImageParseReviewPane
        {...props}
        quality={imageParseQuality(IMAGE_PARSE_SAMPLE_BLOCKS)}
        all
        onRegenerateBlock={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-review-commands]')).toBeNull();
    expect(
      screen.getAllByRole('button', { name: 'imageParseRegenerateBlock' }).length,
    ).toBeGreaterThan(0);
  });

  it('待审核仅展示有分数的区块，隐藏未打分列表及数量', () => {
    const quality = imageParseQuality([
      { ...IMAGE_PARSE_SAMPLE_BLOCKS[0], id: 'low', confidence: 0.375406687981454 },
      {
        ...IMAGE_PARSE_SAMPLE_BLOCKS[0],
        id: 'skipped',
        confidence: null,
        status: 'skipped_no_vlm',
      },
      { ...IMAGE_PARSE_SAMPLE_BLOCKS[0], id: 'failed', confidence: null, status: 'failed' },
    ]);
    const { container } = render(<ImageParseReviewPane {...props} quality={quality} />);
    expect(screen.queryByText(/块未提供分数/)).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'imageParseUnscoredBlocks' })).toBeNull();
    expect(container.querySelectorAll('[data-review-block-id]')).toHaveLength(1);
    expect(quality.missing).toBe(2);
    expect(quality.failed).toHaveLength(1);
    expect(quality.skipped).toHaveLength(1);
  });

  it('查看全部仍只展示已评分块，不展示失败或跳过的区块', () => {
    const quality = imageParseQuality([
      { ...IMAGE_PARSE_SAMPLE_BLOCKS[0], id: 'low', confidence: 0.3 },
      { ...IMAGE_PARSE_SAMPLE_BLOCKS[1], id: 'high', confidence: 0.95 },
      {
        ...IMAGE_PARSE_SAMPLE_BLOCKS[0],
        id: 'skipped',
        confidence: null,
        status: 'skipped_no_vlm',
      },
      { ...IMAGE_PARSE_SAMPLE_BLOCKS[0], id: 'failed', confidence: null, status: 'failed' },
    ]);
    const { container, rerender } = render(<ImageParseReviewPane {...props} quality={quality} />);

    expect(container.querySelectorAll('[data-review-block-id]')).toHaveLength(1);
    rerender(<ImageParseReviewPane {...props} quality={quality} all />);
    expect(container.querySelectorAll('[data-review-block-id]')).toHaveLength(2);
    expect(screen.queryByRole('region', { name: 'imageParseUnscoredBlocks' })).toBeNull();
    expect(screen.queryByText('imageParseSkipped')).not.toBeInTheDocument();
    expect(screen.queryByText('imageParseFailed')).not.toBeInTheDocument();
  });

  it('仅有未打分区块时显示复核空态，不展示状态或原文占位', () => {
    const quality = imageParseQuality([
      {
        ...IMAGE_PARSE_SAMPLE_BLOCKS[0],
        id: 'seal',
        confidence: null,
        status: 'skipped_no_vlm',
        text: '![image]()',
        markdown: '![image]()',
      },
      {
        ...IMAGE_PARSE_SAMPLE_BLOCKS[1],
        id: 'photo',
        confidence: null,
        status: 'skipped_no_vlm',
        text: '',
        markdown: '![](https://example.test/a.png)',
      },
      {
        ...IMAGE_PARSE_SAMPLE_BLOCKS[1],
        id: 'link',
        confidence: null,
        status: 'failed',
        text: '[发票查验](https://example.test/check)',
        markdown: '[发票查验](https://example.test/check)',
      },
    ]);
    render(<ImageParseReviewPane {...props} quality={quality} />);

    expect(screen.getByText('imageParseQualityEmpty')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'imageParseUnscoredBlocks' })).toBeNull();
    expect(screen.queryByText('imageParseSkipped')).not.toBeInTheDocument();
    expect(screen.queryByText('imageParseFailed')).not.toBeInTheDocument();
    expect(screen.queryByText('发票查验')).not.toBeInTheDocument();
    expect(screen.queryByText(/块未提供分数/)).not.toBeInTheDocument();
  });

  it('筛选由顶栏控制，切换不重建保留的审核卡片', () => {
    const quality = imageParseQuality([
      { ...IMAGE_PARSE_SAMPLE_BLOCKS[0], id: 'low', confidence: 0.3 },
      { ...IMAGE_PARSE_SAMPLE_BLOCKS[1], id: 'high', confidence: 0.99 },
    ]);
    const { container, rerender } = render(<ImageParseReviewPane {...props} quality={quality} />);
    const low = container.querySelector('[data-review-item="low"]');
    rerender(<ImageParseReviewPane {...props} quality={quality} all />);
    expect(container.querySelectorAll('[data-review-block-id]')).toHaveLength(2);
    expect(container.querySelector('[data-review-item="low"]')).toBe(low);
    rerender(<ImageParseReviewPane {...props} quality={quality} />);
    expect(container.querySelectorAll('[data-review-block-id]')).toHaveLength(1);
    expect(container.querySelector('[data-review-item="low"]')).toBe(low);
  });

  it('点击区块行保持默认阴影卡片，仅定位和选中，不新增描边或重复原文', () => {
    const original = '备注：无法辨认的文字请标记为 [?]，不要猜测填空。';
    const quality = imageParseQuality([
      { ...IMAGE_PARSE_SAMPLE_BLOCKS[0], id: 'low', confidence: 0.77, text: original },
    ]);
    const onSelectBlock = vi.fn();
    const { container, rerender } = render(
      <ImageParseReviewPane {...props} quality={quality} onSelectBlock={onSelectBlock} />,
    );
    const row = container.querySelector('[data-review-block-id="low"]') as HTMLButtonElement;
    const card = row.closest('[data-review-item]')!;
    const defaultCardClass = card.className;
    expect(card).toHaveClass('bg-card', 'shadow-card-hover');
    expect(card).not.toHaveClass('border', 'border-primary', 'ring-1', 'ring-2');
    expect(card.parentElement).toHaveClass('space-y-4');
    expect(row).not.toHaveAttribute('aria-expanded');
    expect(row).not.toHaveAttribute('aria-controls');
    expect(row.querySelector('svg')).toBeNull();
    expect(screen.getAllByText(original)).toHaveLength(1);
    fireEvent.click(row);
    expect(onSelectBlock).toHaveBeenCalledWith('low');
    rerender(
      <ImageParseReviewPane
        {...props}
        quality={quality}
        selectedBlockId="low"
        onSelectBlock={onSelectBlock}
      />,
    );
    expect(row).toHaveAttribute('aria-pressed', 'true');
    expect(card).toHaveAttribute('class', defaultCardClass);
    expect(screen.getAllByText(original)).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'imageParseQualityDetails' })).toBeNull();
    fireEvent.click(row);
    expect(row).not.toHaveAttribute('aria-expanded');
    expect(onSelectBlock).toHaveBeenCalledTimes(2);
  });
  it('长原文完整显示且滚动区域可键盘操作，不截断到摘要长度', () => {
    const original = '这是需要核对的长文本内容。'.repeat(80);
    const quality = imageParseQuality([
      { ...IMAGE_PARSE_SAMPLE_BLOCKS[0], id: 'low', confidence: 0.3, text: original },
    ]);
    const { container } = render(
      <ImageParseReviewPane
        {...props}
        quality={quality}
        selectedBlockId="low"
        onSelectBlock={vi.fn()}
      />,
    );
    const row = container.querySelector('[data-review-block-id="low"]') as HTMLButtonElement;

    expect(row).toHaveTextContent(original);
    expect(row).toHaveClass('max-h-60', 'overflow-y-auto');
    expect(row.querySelector('.line-clamp-2')).toBeNull();
    expect(row).not.toHaveAttribute('aria-expanded');
    expect(row).toHaveAttribute('aria-pressed', 'true');
  });

  it('重生成按钮独立于定位操作，不重复展示详情', () => {
    const quality = imageParseQuality([
      { ...IMAGE_PARSE_SAMPLE_BLOCKS[0], id: 'low', confidence: 0 },
    ]);
    const onSelectBlock = vi.fn();
    const onRegenerateBlock = vi.fn();
    const { container } = render(
      <>
        <ImageParseReviewPane
          {...props}
          quality={quality}
          selectedBlockId="low"
          onSelectBlock={onSelectBlock}
          regenerationAvailable
          ranges={new Map([['low', { start: 0, end: 5 }]])}
          onRegenerateBlock={onRegenerateBlock}
        />
        <ImageParseReviewPane {...props} quality={quality} selectedBlockId="low" />
      </>,
    );
    const rows = container.querySelectorAll('[data-review-block-id="low"]');
    expect(rows[0]).not.toHaveAttribute('aria-controls');
    expect(rows[1]).not.toHaveAttribute('aria-controls');
    fireEvent.click(screen.getByRole('button', { name: 'imageParseRegenerateBlock' }));
    expect(onRegenerateBlock).toHaveBeenCalledWith('low');
    expect(onSelectBlock).not.toHaveBeenCalled();
    expect(rows[0]).toHaveAttribute('aria-pressed', 'true');
    expect(rows[0]).not.toHaveAttribute('aria-expanded');
  });

  it('审核行采用固定分数列和紧凑操作区，不重复显示状态徽标', () => {
    const quality = imageParseQuality([
      { ...IMAGE_PARSE_SAMPLE_BLOCKS[0], id: 'low', confidence: 0 },
    ]);
    const { container } = render(
      <ImageParseReviewPane {...props} quality={quality} onRegenerateBlock={vi.fn()} />,
    );
    const row = container.querySelector('[data-review-block-id="low"]')!;
    const score = screen.getByText('0%');
    expect(score).toHaveClass('sticky', 'top-0', 'w-10', 'shrink-0', 'tabular-nums');
    expect(row.querySelector('.rounded-full')).toBeNull();
    expect(row.querySelector('.sr-only')).toHaveTextContent('imageParseReview');
    const action = screen.getByRole('button', { name: 'imageParseRegenerateBlock' });
    expect(action).toHaveClass(...WORKSPACE_ICON_CONTROL.split(' '));
    expect(action.closest('[data-review-item]')).toBe(row.closest('[data-review-item]'));
    expect(action.closest('[data-review-actions]')).not.toHaveClass('border-l');
    expect(action).toBeDisabled();
  });

  it('高分仍可自行复核，不标记为确认；缺少文本映射时只允许定位原图', () => {
    const quality = imageParseQuality([
      { ...IMAGE_PARSE_SAMPLE_BLOCKS[0], id: 'high', confidence: 0.8 },
    ]);
    const onSelectBlock = vi.fn();
    const { container, rerender } = render(
      <ImageParseReviewPane {...props} quality={quality} onSelectBlock={onSelectBlock} />,
    );
    expect(screen.getByText('imageParseQualityNoLowScoresHint')).toBeInTheDocument();
    expect(container.querySelector('[data-review-block-id]')).toBeNull();
    rerender(
      <ImageParseReviewPane {...props} quality={quality} all onSelectBlock={onSelectBlock} />,
    );
    fireEvent.click(container.querySelector('[data-review-block-id="high"]')!);
    expect(onSelectBlock).toHaveBeenCalledWith('high');
    rerender(<ImageParseReviewPane {...props} quality={quality} all selectedBlockId="high" />);
    expect(screen.getByText('imageParseQualityUnmapped')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /imageParseQualityShowMarkdown/ })).toBeNull();
  });

  it('已提升的块保留原始和最优对比，不随待审核数量归零而隐藏，也不折叠', () => {
    const original = {
      ...IMAGE_PARSE_SAMPLE_BLOCKS[2],
      id: 'low',
      markdown: '原文 99',
      confidence: 0.4,
    };
    const best = { ...original, markdown: '新文 996', confidence: 0.9 };
    const { container } = render(
      <ImageParseReviewPane
        {...props}
        quality={imageParseQuality([best])}
        results={{ low: { original, best, improved: true, rounds: 1 } }}
      />,
    );
    expect(container.querySelector('[data-review-block-id="low"]')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'imageParseBestVersion' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'imageParseOriginalVersion' })).toBeVisible();
    expect(screen.getAllByRole('region')[0]).toHaveAccessibleName('imageParseBestVersion');
    expect(container.querySelectorAll('mark')).toHaveLength(2);
    expect(container.querySelector('[data-review-block-id="low"]')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('整块一张卡：对比默认展开，可收起再展开，且与卡头同属一张卡', () => {
    const original = {
      ...IMAGE_PARSE_SAMPLE_BLOCKS[2],
      id: 'low',
      markdown: '原文 99',
      confidence: 0.4,
    };
    const best = { ...original, markdown: '新文 996', confidence: 0.9 };
    const { container } = render(
      <ImageParseReviewPane
        {...props}
        quality={imageParseQuality([best])}
        results={{ low: { original, best, improved: true, rounds: 1 } }}
        onRegenerateBlock={vi.fn()}
      />,
    );
    const card = container.querySelector('[data-review-item="low"]')!;
    expect(card).toHaveClass('rounded-xl', 'bg-card', 'shadow-card-hover', 'overflow-hidden');
    expect(card.querySelectorAll('.shadow-card, .shadow-card-hover')).toHaveLength(0);
    expect(card.querySelector('[data-review-block-id="low"]')).not.toBeNull();
    expect(card.querySelector('[data-regeneration-comparison]')).not.toBeNull();

    const collapse = screen.getByRole('button', { name: 'imageParseComparisonCollapse' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(collapse);
    expect(container.querySelector('[data-regeneration-comparison]')).toBeNull();
    // 收起只影响对比，卡头与分数仍留在列表里。
    expect(container.querySelector('[data-review-block-id="low"]')).not.toBeNull();

    const expand = screen.getByRole('button', { name: 'imageParseComparisonExpand' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(expand);
    expect(container.querySelector('[data-regeneration-comparison]')).not.toBeNull();
  });

  it('默认只展示建议复核，并可查看全部有分数区块', () => {
    const quality = imageParseQuality([
      { ...IMAGE_PARSE_SAMPLE_BLOCKS[0], id: 'high-1', confidence: 0.96 },
      { ...IMAGE_PARSE_SAMPLE_BLOCKS[1], id: 'high-2', confidence: 0.91 },
    ]);
    const { container, rerender } = render(<ImageParseReviewPane {...props} quality={quality} />);

    expect(container.querySelectorAll('[data-review-block-id]')).toHaveLength(0);
    expect(screen.getByText('imageParseQualityNoLowScores')).toBeInTheDocument();
    rerender(<ImageParseReviewPane {...props} quality={quality} all />);
    expect(container.querySelectorAll('[data-review-block-id]')).toHaveLength(2);
  });

  it('大结果按传入分页展示，换空结果后不保留旧条目和详情', () => {
    const quality = imageParseQuality(
      Array.from({ length: 2000 }, (_, order) => ({
        ...IMAGE_PARSE_SAMPLE_BLOCKS[0],
        id: `block-${order}`,
        confidence: 0.9,
      })),
    );
    const { container, rerender } = render(
      <ImageParseReviewPane key="old" {...props} quality={quality} all />,
    );
    expect(container.querySelectorAll('[data-review-block-id]')).toHaveLength(40);
    rerender(<ImageParseReviewPane key="old" {...props} quality={quality} all limit={80} />);
    expect(container.querySelectorAll('[data-review-block-id]')).toHaveLength(80);
    rerender(<ImageParseReviewPane key="new" {...props} quality={imageParseQuality([])} />);
    expect(screen.getByText('imageParseQualityEmpty')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-review-block-id]')).toHaveLength(0);
    expect(screen.queryByRole('region', { name: 'imageParseQualityDetails' })).toBeNull();
  });
});
