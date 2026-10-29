import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ImageParseComparison } from './ImageParseComparison';
import type { ImageParseRegeneration } from '../../utils/imageParseRegeneration';
import { IMAGE_PARSE_SAMPLE_BLOCKS } from '../../utils/__tests__/imageParseSampleFixtures';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const original = {
  ...IMAGE_PARSE_SAMPLE_BLOCKS[2],
  markdown: '备注：原始文字。',
  confidence: 0.4,
};
const best = { ...original, markdown: '备注：优化文字。', confidence: 0.9 };
const result: ImageParseRegeneration = { original, best, improved: true, rounds: 1 };

describe('复核结果对比', () => {
  it('最优结果先展示，分数、正文和差异仍与对应版本绑定', () => {
    render(<ImageParseComparison result={result} />);
    const regions = screen.getAllByRole('region');
    expect(regions.map((region) => region.getAttribute('aria-label'))).toEqual([
      'imageParseBestVersion',
      'imageParseOriginalVersion',
    ]);
    const bestRegion = screen.getByRole('region', { name: 'imageParseBestVersion' });
    const originalRegion = screen.getByRole('region', { name: 'imageParseOriginalVersion' });
    expect(within(bestRegion).getByText('90%')).toBeInTheDocument();
    expect(within(originalRegion).getByText('40%')).toBeInTheDocument();
    expect(bestRegion.querySelector('pre')).toHaveTextContent(best.markdown);
    expect(originalRegion.querySelector('pre')).toHaveTextContent(original.markdown);
    expect(bestRegion.querySelector('mark')).toHaveTextContent('优化');
    expect(originalRegion.querySelector('mark')).toHaveTextContent('原始');
    expect(within(bestRegion).getByText('imageParseBestVersion').parentElement).toHaveClass(
      'text-primary',
    );
    expect(screen.getByRole('status')).toHaveTextContent('imageParseRegenerateImproved');
  });

  it('无提升和错误仍保留两版正文，不隐藏当前最佳版本', () => {
    const unchanged = { ...result, best: original, improved: false };
    const { container, rerender } = render(<ImageParseComparison result={unchanged} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText('imageParseRegenerateNoImprovement')).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-regeneration-comparison]')?.firstElementChild,
    ).toHaveClass('grid');
    expect(screen.getAllByText('40%')).toHaveLength(2);
    expect(document.querySelector('mark')).toBeNull();
    rerender(
      <ImageParseComparison result={{ ...unchanged, error: 'imageParseRegenerateFailed' }} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('imageParseRegenerateFailed');
    expect(screen.getAllByRole('region')).toHaveLength(2);
  });

  it.each([
    { improved: false, exhausted: false },
    { improved: false, exhausted: true },
    { improved: true, exhausted: false },
    { improved: true, exhausted: true },
  ])('不展示优化轮次或上限信息，保留两版内容：%j', ({ improved, exhausted }) => {
    const { container } = render(
      <ImageParseComparison
        result={{ ...result, improved, rounds: 5, optimization: { roundsUsed: 5, exhausted } }}
      />,
    );
    expect(screen.queryByText(/imageParseServerOptimizationRounds/)).not.toBeInTheDocument();
    expect(screen.queryByText(/imageParseServerOptimizationExhausted/)).not.toBeInTheDocument();
    expect(screen.queryByText('imageParseRegenerateNoImprovement')).not.toBeInTheDocument();
    expect(screen.getAllByRole('region')).toHaveLength(2);
    expect(container.querySelector('pre')).toHaveTextContent(best.markdown);
    expect(container.querySelectorAll('.shadow-card')).toHaveLength(0);
  });
});
