import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@map/ui';

import { ImageParseResultPane } from './ImageParseResultPane';
import type { useImageParse } from '../../hooks/useImageParse';
import type { useImageParseRegeneration } from '../../hooks/useImageParseRegeneration';
import { IMAGE_PARSE_SAMPLE_BLOCKS } from '../../utils/__tests__/imageParseSampleFixtures';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const content = '目标文字\n\n| 项目 | 金额 |\n| --- | --- |\n| GPU | 960 |';
const ranges = new Map([
  ['text', { start: 0, end: 4 }],
  ['table', { start: content.indexOf('|'), end: content.length }],
]);
const parse = {
  resultKey: 'preview-review',
  markdown: content,
  loading: false,
  layout: [],
  crops: [],
} as unknown as ReturnType<typeof useImageParse>;
const draft = {
  value: content,
  dirty: false,
  ranges,
  setValue: vi.fn(),
  reset: vi.fn(),
};

function setup(
  selectedBlockId?: string,
  overrides: Partial<ReturnType<typeof useImageParseRegeneration>> = {},
  reviewEnabled = true,
) {
  const regeneration = {
    available: true,
    eligibleLowCount: 0,
    results: {},
    pending: new Set<string>(),
    layout: [],
    busy: false,
    reset: vi.fn(),
    stop: vi.fn(),
    regenerateBlock: vi.fn().mockResolvedValue(undefined),
    regenerateLowBlocks: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const onSelectBlock = vi.fn();
  const props = {
    parse,
    draft,
    ranges,
    json: '',
    onCopyRegion: vi.fn(),
    linkedRanges: [...ranges].map(([id, range]) => ({ id, range })),
    selectedBlockId,
    regeneration,
    reviewEnabled,
    onSelectBlock,
    tab: 'preview',
  };
  const view = render(<ImageParseResultPane {...props} />, { wrapper: TooltipProvider });
  return { ...view, props, regeneration, onSelectBlock };
}

describe('结果预览单块复核', () => {
  it('待复核隐藏时保留区域复制，不显示重生成入口', async () => {
    const { props } = setup('text', {}, false);
    const copy = await screen.findByRole('button', { name: 'imageParseCopyRegion' });
    expect(copy).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'imageParseRegenerateBlock' })).toBeNull();
    fireEvent.click(copy);
    expect(props.onCopyRegion).toHaveBeenCalledExactlyOnceWith('text');
  });

  it('未接入重生成时仍保留区域复制', async () => {
    const onCopyRegion = vi.fn();
    const { container } = render(
      <ImageParseResultPane
        parse={parse}
        draft={draft}
        ranges={ranges}
        onCopyRegion={onCopyRegion}
        linkedRanges={[...ranges].map(([id, range]) => ({ id, range }))}
        selectedBlockId="text"
        tab="preview"
      />,
      { wrapper: TooltipProvider },
    );
    const copy = await screen.findByRole('button', { name: 'imageParseCopyRegion' });
    fireEvent.click(copy);
    expect(onCopyRegion).toHaveBeenCalledExactlyOnceWith('text');
    expect(container.querySelector('[data-preview-review]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'imageParseRegenerateBlock' })).toBeNull();
  });

  it('仅选中时展示操作，悬停不展示；切换选中块时跟随', async () => {
    const { container, props, rerender, regeneration } = setup();
    fireEvent.mouseOver(screen.getByText('目标文字'));
    expect(screen.queryByRole('button', { name: 'imageParseCopyRegion' })).toBeNull();

    rerender(<ImageParseResultPane {...props} selectedBlockId="text" />);
    const copy = await screen.findByRole('button', { name: 'imageParseCopyRegion' });
    fireEvent.click(copy);
    expect(props.onCopyRegion).toHaveBeenCalledExactlyOnceWith('text');
    fireEvent.click(screen.getByRole('button', { name: 'imageParseRegenerateBlock' }));
    expect(regeneration.regenerateBlock).toHaveBeenCalledExactlyOnceWith('text');

    rerender(<ImageParseResultPane {...props} selectedBlockId="table" />);
    await waitFor(() =>
      expect(container.querySelector('[data-preview-review]')).toHaveAttribute(
        'data-preview-review',
        'table',
      ),
    );
    rerender(<ImageParseResultPane {...props} selectedBlockId={undefined} />);
    await waitFor(() => expect(container.querySelector('[data-preview-review]')).toBeNull());
  });

  it('更优结果更新正文，完成反馈仅保留在按钮提示中', async () => {
    const original = {
      ...IMAGE_PARSE_SAMPLE_BLOCKS[2],
      id: 'text',
      confidence: 0.4,
      text: '目标文字',
      markdown: '目标文字',
    };
    const best = { ...original, confidence: 0.91, text: '更新文字', markdown: '更新文字' };
    const { rerender, props, regeneration, container } = setup('text', { layout: [original] });
    expect(await screen.findByRole('button', { name: 'imageParseRegenerateBlock' })).toBeEnabled();
    expect(screen.queryByText('40%')).not.toBeInTheDocument();
    expect(container.querySelector('[data-preview-score]')).toBeNull();
    rerender(
      <ImageParseResultPane
        {...props}
        draft={{ ...draft, value: content.replace('目标文字', '更新文字') }}
        regeneration={{
          ...regeneration,
          layout: [best],
          results: { text: { original, best, improved: true, rounds: 1 } },
        }}
      />,
    );
    expect(await screen.findByText('更新文字')).toBeInTheDocument();
    const action = screen.getByRole('button', { name: 'imageParseRegenerateBlock' });
    expect(action).toBeDisabled();
    expect(action).toHaveAttribute('title', 'imageParseRegenerateImproved');
    expect(
      within(action.closest('[data-preview-review]') as HTMLElement).queryByRole('status'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('91%')).not.toBeInTheDocument();
    expect(container.querySelector('[data-preview-score]')).toBeNull();
  });

  it('无提升或失败时不展示常驻说明，仍保留禁用状态和错误提示', async () => {
    const original = {
      ...IMAGE_PARSE_SAMPLE_BLOCKS[2],
      id: 'text',
      confidence: 0.4,
      text: '目标文字',
      markdown: '目标文字',
    };
    const result = { original, best: original, improved: false, rounds: 5 };
    const { rerender, props, regeneration } = setup('text', {
      layout: [original],
      results: { text: result },
    });
    const action = await screen.findByRole('button', { name: 'imageParseRegenerateBlock' });
    expect(screen.queryByText('40%')).not.toBeInTheDocument();
    expect(action).toBeDisabled();
    const preview = action.closest('[data-preview-review]') as HTMLElement;
    expect(screen.queryByText('imageParseRegenerateNoImprovement')).not.toBeInTheDocument();
    expect(within(preview).queryByRole('status')).not.toBeInTheDocument();
    rerender(
      <ImageParseResultPane
        {...props}
        regeneration={{
          ...regeneration,
          results: { text: { ...result, error: 'imageParseRegenerateFailed' } },
        }}
      />,
    );
    expect(action).toHaveAttribute('title', 'imageParseRegenerateFailed');
    expect(within(preview).queryByRole('status')).not.toBeInTheDocument();
  });

  it.each(['imageParseRegenerateSourceMissing', 'imageParseRegenerateSourceInvalid'])(
    '重算不可用时不展示常驻说明 %s，复制与禁用按钮提示仍可用',
    async (reason) => {
      const user = userEvent.setup();
      const { props } = setup('text', { available: false, unavailableReason: reason });
      const action = await screen.findByRole('button', { name: 'imageParseRegenerateBlock' });
      const preview = action.closest('[data-preview-review]') as HTMLElement;
      expect(action).toBeDisabled();
      expect(action).toHaveAttribute('title', reason);
      expect(within(preview).queryByRole('status')).not.toBeInTheDocument();
      expect(within(preview).queryByText(reason)).not.toBeInTheDocument();
      const copy = screen.getByRole('button', { name: 'imageParseCopyRegion' });
      expect(copy).toBeEnabled();
      await user.click(copy);
      expect(props.onCopyRegion).toHaveBeenCalledExactlyOnceWith('text');
      await user.hover(action.parentElement!);
      expect(await screen.findByRole('tooltip')).toHaveTextContent(reason);
    },
  );

  it('未选中不显示入口，选中正文后执行实际单块回调且不触发编辑或再次定位', async () => {
    const { rerender, props, regeneration, onSelectBlock, container } = setup();
    expect(screen.queryByRole('button', { name: 'imageParseRegenerateBlock' })).toBeNull();
    rerender(<ImageParseResultPane {...props} selectedBlockId="text" />);
    const action = await screen.findByRole('button', { name: 'imageParseRegenerateBlock' });
    expect(action).toBeEnabled();
    fireEvent.doubleClick(action);
    fireEvent.keyDown(action, { key: 'Enter' });
    fireEvent.click(action);
    expect(regeneration.regenerateBlock).toHaveBeenCalledExactlyOnceWith('text');
    expect(onSelectBlock).not.toHaveBeenCalled();
    expect(container.querySelector('[data-visual-editing="true"]')).toBeNull();
  });

  it('选中区域后显示复制图标并传出当前区域标识', async () => {
    const { props } = setup('text');
    const copy = await screen.findByRole('button', { name: 'imageParseCopyRegion' });

    fireEvent.click(copy);

    expect(props.onCopyRegion).toHaveBeenCalledExactlyOnceWith('text');
  });

  it('操作条贴在目标块右下角外侧，类型角标贴在左上角', async () => {
    const bounds = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (this.tagName === 'ARTICLE') return new DOMRect(0, 100, 800, 600);
        if (this.getAttribute('data-ocr-linked-ids')?.includes('"text"'))
          return new DOMRect(40, 160, 680, 48);
        return new DOMRect(0, 0, 0, 0);
      });
    try {
      const { container } = render(
        <ImageParseResultPane
          parse={parse}
          draft={draft}
          ranges={ranges}
          onCopyRegion={vi.fn()}
          linkedRanges={[...ranges].map(([id, range]) => ({ id, range }))}
          selectedBlockId="text"
          previewLayout={[{ ...IMAGE_PARSE_SAMPLE_BLOCKS[2], id: 'text', kind: 'text' }]}
          tab="preview"
        />,
        { wrapper: TooltipProvider },
      );
      await screen.findByRole('button', { name: 'imageParseCopyRegion' });
      const action = container.querySelector<HTMLElement>('[data-preview-review]');
      const label = container.querySelector<HTMLElement>('[data-preview-label]');
      expect(action).not.toBeNull();
      expect(action?.style.top).toBe('114px');
      expect(action?.style.right).toBe('80px');
      expect(label).toHaveTextContent('imageParseBlock_text');
      expect(label?.style.left).toBe('40px');
      expect(label?.style.top).toBe('60px');
    } finally {
      bounds.mockRestore();
    }
  });

  it('选中操作条展示带文字的复制与重生成按钮，不展示分数或分隔线', async () => {
    const { container } = setup('text', {
      layout: [{ ...IMAGE_PARSE_SAMPLE_BLOCKS[2], id: 'text', confidence: 0.99 }],
    });
    await screen.findByRole('button', { name: 'imageParseCopyRegion' });
    const action = container.querySelector('[data-preview-review]');
    const toolbar = container.querySelector('[data-preview-review-toolbar]');
    expect(action).not.toHaveClass('-translate-y-full');
    expect(action).toHaveStyle({ top: '6px', right: '0px' });
    expect(toolbar).toHaveClass('rounded-full', 'bg-card', 'shadow-card', 'p-0.5');
    expect(toolbar).not.toHaveClass('rounded-md');
    expect(screen.queryByText('99%')).not.toBeInTheDocument();
    expect(container.querySelector('[data-preview-score]')).toBeNull();
    expect(toolbar?.querySelector('.border-r')).toBeNull();
    expect(within(toolbar as HTMLElement).getAllByRole('button')).toHaveLength(2);
    for (const label of ['imageParseCopyRegion', 'imageParseRegenerateBlock']) {
      const action = screen.getByRole('button', { name: label });
      expect(toolbar).toContainElement(action);
      expect(action).toHaveClass('rounded-full', 'h-7');
      expect(action).toHaveTextContent(label);
      expect(action.querySelector('svg')).toHaveClass('size-3.5');
    }
  });

  it.each([0, 0.4, 0.98, 1, null, Number.NaN, Infinity, -Infinity, -0.1, 1.1])(
    '任何分数 %s 都不显示百分比、占位和分隔线，保留复制操作',
    async (confidence) => {
      const { container, props } = setup('text', {
        layout: [{ ...IMAGE_PARSE_SAMPLE_BLOCKS[2], id: 'text', confidence }],
      });
      const copy = await screen.findByRole('button', { name: 'imageParseCopyRegion' });
      expect(container.querySelector('[data-preview-score]')).toBeNull();
      expect(screen.queryByText('imageParseScoreMissing')).not.toBeInTheDocument();
      expect(copy.closest('[data-preview-review-toolbar]')?.querySelector('.border-r')).toBeNull();
      fireEvent.click(copy);
      expect(props.onCopyRegion).toHaveBeenCalledWith('text');
    },
  );

  it.each([
    { available: true, mapped: true, disabled: false },
    { available: false, mapped: false, disabled: true },
  ])('图标在普通和禁用状态仍能查看提示：%j', async (state) => {
    const user = userEvent.setup();
    const { rerender, props } = setup('text', { available: state.available });
    if (!state.mapped) rerender(<ImageParseResultPane {...props} ranges={new Map()} />);
    const copy = await screen.findByRole('button', { name: 'imageParseCopyRegion' });
    await user.hover(state.disabled ? copy.parentElement! : copy);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('imageParseCopyRegion');
    await user.unhover(state.disabled ? copy.parentElement! : copy);
    const regenerate = screen.getByRole('button', { name: 'imageParseRegenerateBlock' });
    await user.hover(state.disabled ? regenerate.parentElement! : regenerate);
    await waitFor(() =>
      expect(screen.getByRole('tooltip')).toHaveTextContent(
        state.available ? 'imageParseRegenerateBlock' : 'imageParseRegenerateUnavailable',
      ),
    );
  });

  it('表格复核入口位于滚动表格外，不会随表格横向滚动或被裁切', async () => {
    const { container } = setup('table');
    const action = await screen.findByRole('button', { name: 'imageParseRegenerateBlock' });
    expect(action.closest('article')).not.toBeNull();
    expect(action.closest('[data-document-table]')).toBeNull();
    expect(container.querySelectorAll('td')).toHaveLength(2);
  });

  it.each([{ available: false }, { busy: true }])(
    '服务不可用或有任务执行时禁用入口：%j',
    async (overrides) => {
      const { regeneration } = setup('text', overrides);
      const action = await screen.findByRole('button', { name: 'imageParseRegenerateBlock' });
      expect(action).toBeDisabled();
      fireEvent.click(action);
      expect(regeneration.regenerateBlock).not.toHaveBeenCalled();
    },
  );

  it('执行中仅显示按钮加载状态，切换块后回调使用新块，切换标签隐藏入口', async () => {
    const { rerender, props, regeneration } = setup('text', {
      pending: new Set(['text']),
      busy: true,
    });
    const pending = await screen.findByRole('button', { name: 'imageParseReviewRunning' });
    expect(pending).toBeDisabled();
    expect(pending.querySelector('svg')).toHaveClass('animate-spin');
    expect(
      within(pending.closest('[data-preview-review]') as HTMLElement).queryByRole('status'),
    ).not.toBeInTheDocument();
    rerender(
      <ImageParseResultPane
        {...props}
        selectedBlockId="table"
        regeneration={{ ...regeneration, pending: new Set(), busy: false }}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'imageParseRegenerateBlock' }));
    expect(regeneration.regenerateBlock).toHaveBeenCalledExactlyOnceWith('table');
    rerender(<ImageParseResultPane {...props} tab="review" />);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'imageParseRegenerateBlock' })).toBeNull(),
    );
  });

  it('映射失效时禁止请求，人工编辑时隐藏入口，退出编辑后恢复', async () => {
    const { rerender, props, container, regeneration } = setup('text');
    await screen.findByRole('button', { name: 'imageParseRegenerateBlock' });
    rerender(<ImageParseResultPane {...props} ranges={new Map()} />);
    const action = screen.getByRole('button', { name: 'imageParseRegenerateBlock' });
    expect(action).toBeDisabled();
    expect(action).toHaveAttribute('title', 'imageParseRegenerateUnmapped');
    expect(
      within(action.closest('[data-preview-review]') as HTMLElement).queryByRole('status'),
    ).not.toBeInTheDocument();
    fireEvent.click(action);
    expect(regeneration.regenerateBlock).not.toHaveBeenCalled();
    rerender(<ImageParseResultPane {...props} />);
    const wrapper = container.querySelector('[data-edit-block]')!;
    // 模拟编辑器挂载与卸载，不在此测试中加载第三方编辑器。
    wrapper.setAttribute('data-visual-editing', 'true');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'imageParseRegenerateBlock' })).toBeNull(),
    );
    wrapper.setAttribute('data-visual-editing', 'false');
    expect(await screen.findByRole('button', { name: 'imageParseRegenerateBlock' })).toBeEnabled();
  });
});
