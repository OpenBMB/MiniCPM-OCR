import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ImageParseResultPane } from './ImageParseResultPane';
import type { useImageParse } from '../../hooks/useImageParse';
import type { useImageParseRegeneration } from '../../hooks/useImageParseRegeneration';
import type { ImageParseRegeneration } from '../../utils/imageParseRegeneration';
import { imageParseQuality } from '../../utils/imageParseQuality';
import { IMAGE_PARSE_SAMPLE_BLOCKS } from '../../utils/__tests__/imageParseSampleFixtures';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const layout = Array.from({ length: 90 }, (_, order) => ({
  ...IMAGE_PARSE_SAMPLE_BLOCKS[0],
  id: `block-${order}`,
  order,
  text: `复核文本 ${order}`,
  markdown: `复核文本 ${order}`,
  confidence: order < 45 ? 0.3 : 0.99,
}));
const parse = {
  resultKey: 'review-a',
  markdown: '文档正文',
  loading: false,
  layout,
  crops: [],
} as unknown as ReturnType<typeof useImageParse>;
const props = {
  parse,
  json: '',
  draft: {
    value: parse.markdown,
    dirty: false,
    ranges: new Map(),
    setValue: vi.fn(),
    reset: vi.fn(),
  },
  // 保留待复核实现的单测开关；生产默认隐藏。
  reviewEnabled: true,
};

function rows(container: HTMLElement) {
  return container.querySelectorAll('[data-review-block-id]');
}

function regeneration(
  results: Record<string, ImageParseRegeneration> = {},
  pending: ReadonlySet<string> = new Set(),
): ReturnType<typeof useImageParseRegeneration> {
  return {
    available: true,
    busy: pending.size > 0,
    layout,
    results,
    pending,
    eligibleLowCount: 0,
    reset: vi.fn(),
    stop: vi.fn(),
    regenerateBlock: vi.fn().mockResolvedValue(undefined),
    regenerateLowBlocks: vi.fn().mockResolvedValue(undefined),
  };
}

describe('待复核顶栏与正文接线', () => {
  it('待复核能力默认隐藏，外部误传 review 视图时回落到预览', () => {
    render(
      <ImageParseResultPane
        {...props}
        reviewEnabled={false}
        tab="review"
        regeneration={regeneration()}
      />,
    );

    expect(screen.getByRole('tab', { name: 'imageParsePreview' })).toHaveAttribute(
      'data-state',
      'active',
    );
    expect(screen.queryByRole('tab', { name: /imageParseReview/ })).toBeNull();
    expect(screen.queryByRole('tabpanel', { name: /imageParseReview/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'imageParseRegenerateAll' })).toBeNull();
    expect(document.querySelector('[data-review-block-id]')).toBeNull();
  });

  it('处理中顶栏保留批量操作图标，加载动画只显示在待处理卡片内且不重复执行', () => {
    const blocks = layout.slice(0, 2);
    const actions = regeneration({}, new Set([blocks[0].id]));
    const { container } = render(
      <ImageParseResultPane
        {...props}
        parse={{ ...parse, layout: blocks }}
        tab="review"
        ranges={new Map(blocks.map((block) => [block.id, { start: 0, end: 4 }]))}
        regeneration={actions}
      />,
    );
    const batch = screen.getByRole('button', { name: 'imageParseRegenerating' });
    expect(batch.querySelector('.lucide-refresh-cw')).toBeInTheDocument();
    expect(batch.querySelector('.animate-spin')).toBeNull();
    expect(batch).toBeDisabled();
    const first = container.querySelector('[data-review-item="block-0"]') as HTMLElement;
    const working = within(first).getByRole('button', { name: 'imageParseRegenerateBlock' });
    expect(working).toHaveAttribute('aria-busy', 'true');
    expect(working).toHaveClass('disabled:opacity-100', 'disabled:text-primary');
    expect(working.querySelector('.lucide-loader-circle')).toHaveClass(
      'animate-spin',
      'motion-reduce:animate-none',
    );
    expect(working).toBeDisabled();
    const second = container.querySelector('[data-review-item="block-1"]') as HTMLElement;
    expect(
      within(second).getByRole('button', { name: 'imageParseRegenerateBlock' }),
    ).toBeDisabled();
    expect(second.querySelector('.animate-spin')).toBeNull();
    fireEvent.click(batch);
    fireEvent.click(working);
    expect(actions.regenerateLowBlocks).not.toHaveBeenCalled();
    expect(actions.regenerateBlock).not.toHaveBeenCalled();
  });

  it('每块成功复核后扣减待复核数量，即使未提分或仍低于阈值，也保留对比', () => {
    const blocks = layout.slice(0, 2).map((block) => ({ ...block, confidence: 0.4 }));
    const first = { original: blocks[0], best: blocks[0], rounds: 5, improved: false };
    const second = {
      original: blocks[1],
      best: { ...blocks[1], confidence: 0.7 },
      rounds: 5,
      improved: true,
    };
    const currentProps = {
      ...props,
      parse: { ...parse, layout: blocks },
      quality: imageParseQuality(blocks),
      tab: 'review',
    };
    const { container, rerender } = render(
      <ImageParseResultPane {...currentProps} regeneration={regeneration()} />,
    );
    const reviewTab = screen.getByRole('tab', { name: /imageParseReview/ });
    expect(reviewTab).toHaveTextContent('2');
    rerender(
      <ImageParseResultPane
        {...currentProps}
        regeneration={regeneration({ [blocks[0].id]: first })}
      />,
    );
    expect(reviewTab).toHaveTextContent('1');
    expect(rows(container)).toHaveLength(2);
    expect(screen.getByRole('region', { name: 'imageParseBestVersion' })).toHaveTextContent('40%');
    rerender(
      <ImageParseResultPane
        {...currentProps}
        regeneration={regeneration({ [blocks[0].id]: first, [blocks[1].id]: second })}
      />,
    );
    expect(reviewTab).toHaveTextContent(/^imageParseReview$/);
    expect(reviewTab.querySelector('span')).toBeNull();
    expect(rows(container)).toHaveLength(2);
    expect(screen.getAllByRole('region', { name: 'imageParseBestVersion' })).toHaveLength(2);
    expect(screen.getAllByRole('region', { name: 'imageParseOriginalVersion' })).toHaveLength(2);
    rerender(
      <ImageParseResultPane
        {...currentProps}
        parse={{ ...currentProps.parse, resultKey: 'other-page' }}
        regeneration={regeneration()}
      />,
    );
    expect(reviewTab).toHaveTextContent('2');
  });

  it('处理中与失败不扣减，成功记录只扣减当前低分块，避免重复或跨页扣减', () => {
    const low = layout[0];
    const high = layout[45];
    const record = { original: low, best: low, rounds: 5, improved: false };
    const currentProps = {
      ...props,
      parse: { ...parse, layout: [low, high] },
      tab: 'review',
    };
    const { rerender } = render(
      <ImageParseResultPane {...currentProps} regeneration={regeneration({}, new Set([low.id]))} />,
    );
    const reviewTab = screen.getByRole('tab', { name: /imageParseReview/ });
    expect(reviewTab).toHaveTextContent('1');
    rerender(
      <ImageParseResultPane
        {...currentProps}
        regeneration={regeneration({
          [low.id]: { ...record, error: 'imageParseRegenerateFailed' },
          [high.id]: { ...record, original: high, best: high },
          'other-page': record,
        })}
      />,
    );
    expect(reviewTab).toHaveTextContent('1');
    expect(screen.getByRole('alert')).toHaveTextContent('imageParseRegenerateFailed');
    rerender(
      <ImageParseResultPane {...currentProps} regeneration={regeneration({ [low.id]: record })} />,
    );
    expect(reviewTab).toHaveTextContent(/^imageParseReview$/);
    rerender(
      <ImageParseResultPane {...currentProps} regeneration={regeneration({ [low.id]: record })} />,
    );
    expect(reviewTab).toHaveTextContent(/^imageParseReview$/);
  });

  it('顶栏筛选控制正文，切换筛选重置分页且不重建保留的卡片', () => {
    const { container, rerender } = render(<ImageParseResultPane {...props} tab="review" />);
    expect(rows(container)).toHaveLength(40);
    const pane = screen.getByRole('tabpanel', { name: /imageParseReview/ });
    expect(pane).toHaveClass('bg-card');
    expect(pane).not.toHaveClass('bg-muted/50');
    expect(screen.getByRole('tabpanel', { name: /imageParsePreview/, hidden: true })).toHaveClass(
      'bg-card',
    );
    expect(within(pane).queryByRole('button', { name: 'imageParseQualityAll' })).toBeNull();
    expect(
      within(pane)
        .getAllByText('imageParseReview')
        .every((label) => label.classList.contains('sr-only')),
    ).toBe(true);
    const first = container.querySelector('[data-review-item="block-0"]');
    expect(first).toHaveClass('bg-card', 'shadow-card-hover');
    fireEvent.click(screen.getByRole('button', { name: 'loadMore' }));
    expect(rows(container)).toHaveLength(45);
    fireEvent.click(screen.getByRole('button', { name: 'imageParseQualityAll' }));
    expect(rows(container)).toHaveLength(40);
    expect(container.querySelector('[data-review-item="block-0"]')).toBe(first);
    fireEvent.click(screen.getByRole('button', { name: 'loadMore' }));
    expect(rows(container)).toHaveLength(80);
    rerender(<ImageParseResultPane {...props} tab="source" />);
    expect(screen.queryByRole('button', { name: 'imageParseQualityOnlySuggested' })).toBeNull();
    rerender(<ImageParseResultPane {...props} tab="review" />);
    expect(rows(container)).toHaveLength(80);
    expect(screen.getByRole('button', { name: 'imageParseQualityOnlySuggested' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'imageParseQualityOnlySuggested' }));
    expect(rows(container)).toHaveLength(40);
  });

  it('更换结果同步重置筛选与分页，再返回旧结果也不恢复过期筛选', () => {
    const { container, rerender } = render(<ImageParseResultPane {...props} tab="review" />);
    fireEvent.click(screen.getByRole('button', { name: 'imageParseQualityAll' }));
    fireEvent.click(screen.getByRole('button', { name: 'loadMore' }));
    expect(rows(container)).toHaveLength(80);
    rerender(
      <ImageParseResultPane {...props} parse={{ ...parse, resultKey: 'review-b' }} tab="review" />,
    );
    expect(rows(container)).toHaveLength(40);
    expect(screen.getByRole('button', { name: 'imageParseQualityAll' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    rerender(<ImageParseResultPane {...props} tab="review" />);
    expect(rows(container)).toHaveLength(40);
    expect(screen.getByRole('button', { name: 'imageParseQualityAll' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('未传入受控标签时切换到待复核仍显示顶栏筛选，并传出标签变化', () => {
    const onTabChange = vi.fn();
    render(<ImageParseResultPane {...props} onTabChange={onTabChange} />);
    expect(screen.queryByRole('button', { name: 'imageParseQualityAll' })).toBeNull();
    fireEvent.mouseDown(screen.getByRole('tab', { name: /imageParseReview/ }), {
      button: 0,
      ctrlKey: false,
    });
    expect(onTabChange).toHaveBeenCalledExactlyOnceWith('review');
    expect(screen.getByRole('button', { name: 'imageParseQualityAll' })).toBeVisible();
  });
});
