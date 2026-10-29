import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Tabs, TooltipProvider } from '@map/ui';

import type { useImageParseRegeneration } from '../../hooks/useImageParseRegeneration';
import { ImageParseResultToolbar } from './ImageParseResultToolbar';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function regeneration(
  overrides: Partial<ReturnType<typeof useImageParseRegeneration>> = {},
): ReturnType<typeof useImageParseRegeneration> {
  return {
    available: true,
    busy: false,
    layout: [],
    results: {},
    pending: new Set(),
    regenerateBlock: vi.fn().mockResolvedValue(undefined),
    regenerateLowBlocks: vi.fn().mockResolvedValue(undefined),
    eligibleLowCount: 0,
    reset: vi.fn(),
    stop: vi.fn(),
    ...overrides,
  };
}

const props = {
  loading: false,
  reviewCount: 2,
  hasJson: false,
  draft: {
    value: '',
    dirty: false,
    ranges: new Map(),
    setValue: vi.fn(),
    reset: vi.fn(),
  },
  linked: true,
  onToggleLinked: vi.fn(),
  onDownload: vi.fn(),
  settingsVisible: true,
  showBlocks: true,
  hasBlocks: true,
  onToggleBlocks: vi.fn(),
  upright: true,
  onUprightChange: vi.fn(),
  recognizeSeal: true,
  onRecognizeSealChange: vi.fn(),
  hasScoredBlocks: true,
  // 保留待复核实现的单测开关；生产默认隐藏。
  reviewEnabled: true,
  reviewAll: false,
  onToggleReviewAll: vi.fn(),
};

describe('OCR 结果工具栏', () => {
  it('待复核能力默认隐藏，不渲染待复核标签和批量操作', () => {
    render(
      <Tabs defaultValue="preview">
        <ImageParseResultToolbar {...props} reviewEnabled={false} regeneration={regeneration()} />
      </Tabs>,
    );

    expect(screen.queryByRole('tab', { name: /imageParseReview/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'imageParseRegenerateAll' })).toBeNull();
    expect(screen.getByRole('button', { name: 'imageParseDownload' })).toBeVisible();
  });

  it('双栏联动收纳在显示设置菜单中', async () => {
    const user = userEvent.setup();
    const onToggleLinked = vi.fn();
    render(
      <Tabs defaultValue="preview">
        <ImageParseResultToolbar {...props} onToggleLinked={onToggleLinked} />
      </Tabs>,
    );
    const action = screen.getByRole('button', { name: 'imageParseDisplaySettings' });
    await user.click(action);
    const linked = screen.getByRole('menuitemcheckbox', { name: 'imageParseLinked' });
    expect(linked).toBeChecked();
    await user.keyboard('{Escape}');
    expect(document.querySelector('[data-tour="image-parse-download"]')).toBe(
      screen.getByRole('button', { name: 'imageParseDownload' }),
    );
    await user.click(action);
    const reopenedLinked = screen.getByRole('menuitemcheckbox', { name: 'imageParseLinked' });
    await user.click(reopenedLinked);
    expect(onToggleLinked).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'imageParseLinked' })).toBeNull();
  });

  it('识别设置与显示设置拆分为独立入口', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <Tabs defaultValue="preview">
          <ImageParseResultToolbar {...props} />
        </Tabs>
      </TooltipProvider>,
    );

    expect(screen.queryByRole('button', { name: 'imageParseSettings' })).toBeNull();
    const recognition = screen.getByRole('button', { name: 'imageParseRecognitionSettings' });
    const display = screen.getByRole('button', { name: 'imageParseDisplaySettings' });
    expect(recognition).toBeVisible();
    expect(display).toBeVisible();

    await user.click(recognition);
    expect(screen.getByRole('switch', { name: /imageParseRecognizeSeal/ })).toBeVisible();
    expect(screen.getByRole('switch', { name: /imageParseRecognizeChart/ })).toBeVisible();
    expect(screen.getByRole('switch', { name: /imageParseUpright/ })).toBeVisible();
    expect(screen.queryByRole('menuitemcheckbox', { name: 'imageParseLinked' })).toBeNull();

    await user.keyboard('{Escape}');
    await user.click(display);
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'imageParseShowConfidence' }),
    ).toBeVisible();
    expect(screen.getByRole('menuitemcheckbox', { name: 'imageParseLinked' })).toBeVisible();
    expect(screen.queryByRole('switch', { name: /imageParseRecognizeSeal/ })).toBeNull();
  });

  it('识别完成后不展示勾选图标，保留加载提示和无障碍完成状态', () => {
    const { rerender } = render(
      <Tabs defaultValue="preview">
        <ImageParseResultToolbar {...props} loading />
      </Tabs>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('imageParseParsing');
    expect(screen.getByRole('status').querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('status')).not.toHaveClass('sr-only');
    rerender(
      <Tabs defaultValue="preview">
        <ImageParseResultToolbar {...props} />
      </Tabs>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('imageParseCompleted');
    expect(screen.getByRole('status').querySelector('svg')).toBeNull();
    expect(screen.getByRole('status')).toHaveClass('sr-only');
    expect(screen.getByRole('button', { name: 'imageParseRecognitionSettings' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'imageParseDisplaySettings' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'imageParseDownload' })).toBeVisible();
  });

  it('状态与操作文字都在标签栏右侧，窄栏内可换行', () => {
    const { container } = render(
      <Tabs defaultValue="preview">
        <ImageParseResultToolbar {...props} draft={{ ...props.draft, dirty: true }} />
      </Tabs>,
    );
    const navigation = container.querySelector('[data-result-navigation]');
    expect(navigation).toHaveClass('min-h-11', '[@media(pointer:coarse)]:min-h-14');
    expect(screen.getByRole('tablist')).toHaveClass('h-auto', 'self-stretch');
    expect(navigation).toContainElement(screen.getByRole('tablist'));
    expect(navigation).toContainElement(screen.getByRole('status'));
    for (const label of [
      'imageParseResetDraft',
      'imageParseRecognitionSettings',
      'imageParseDisplaySettings',
      'imageParseDownload',
    ]) {
      expect(navigation).toContainElement(screen.getByRole('button', { name: label }));
    }
    expect(screen.getByRole('button', { name: 'imageParseResetDraft' })).toHaveAttribute(
      'title',
      'imageParseResetDraftHint',
    );
    expect(screen.getByRole('button', { name: 'imageParseDownload' })).toHaveAttribute(
      'title',
      'imageParseDownloadHint',
    );
    const commands = container.querySelector<HTMLElement>('[data-result-commands]');
    expect(navigation).toContainElement(commands);
    expect(commands).toHaveClass('flex-wrap', 'min-w-0', 'max-w-full');
    expect(screen.queryByRole('button', { name: 'imageParseHideHeaderFooter' })).toBeNull();
    expect(navigation?.parentElement?.children).toHaveLength(1);
  });

  it('视图标签保持紧凑，不包含右侧操作及整行空白', () => {
    render(
      <Tabs defaultValue="preview">
        <ImageParseResultToolbar {...props} activeTab="preview" />
      </Tabs>,
    );
    const target = screen.getByRole('tablist');
    expect(target).not.toHaveAttribute('data-tour');
    expect(target).toHaveClass('max-w-full', 'flex-initial');
    expect(target).not.toHaveClass('flex-1', 'flex-auto');
    expect(target).not.toContainElement(
      screen.getByRole('button', { name: 'imageParseRecognitionSettings' }),
    );
    expect(target).not.toContainElement(
      screen.getByRole('button', { name: 'imageParseDisplaySettings' }),
    );
    expect(target).not.toContainElement(screen.getByRole('button', { name: 'imageParseDownload' }));
  });

  it.each([
    { loading: false, available: true, busy: false },
    { loading: true, available: true, busy: false },
    { loading: false, available: false, busy: false },
    { loading: false, available: true, busy: true },
  ])('状态 %j 均不显示一键重生成', ({ loading, available, busy }) => {
    render(
      <Tabs defaultValue="preview">
        <ImageParseResultToolbar
          {...props}
          loading={loading}
          regeneration={regeneration({ available, busy })}
        />
      </Tabs>,
    );
    expect(screen.queryByRole('button', { name: 'imageParseRegenerateAll' })).toBeNull();
    expect(screen.getByRole('tab', { name: /imageParseReview/ })).toHaveTextContent('2');
  });

  it('保留视图切换、双栏联动及导出操作，不显示全局复制入口', async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(
      <Tabs defaultValue="preview" onValueChange={onTabChange}>
        <ImageParseResultToolbar {...props} regeneration={regeneration()} />
      </Tabs>,
    );
    fireEvent.mouseDown(screen.getByRole('tab', { name: /imageParseReview/ }), {
      button: 0,
      ctrlKey: false,
    });
    expect(onTabChange).toHaveBeenCalledWith('review');
    expect(screen.queryByRole('button', { name: 'copy' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'imageParseDisplaySettings' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'imageParseLinked' }));
    await user.keyboard('{Escape}');
    expect(props.onToggleLinked).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'imageParseCopyRegion' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'imageParseCopyTable' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'imageParseDownload' }));
    await user.click(screen.getByRole('menuitem', { name: 'Word .docx' }));
    expect(props.onDownload).toHaveBeenCalledExactlyOnceWith('word');
  });

  it('待审核页收起联动与导出，复核操作集中在标签栏右侧', () => {
    const view = render(
      <Tabs value="review" onValueChange={() => undefined}>
        <ImageParseResultToolbar {...props} regeneration={regeneration()} activeTab="review" />
      </Tabs>,
    );
    expect(document.querySelector('[data-result-commands]')).toBeNull();
    const navigation = document.querySelector('[data-result-navigation]');
    expect(navigation).toContainElement(
      screen.getByRole('button', { name: 'imageParseRegenerateAll' }),
    );
    const filter = screen.getByRole('button', { name: 'imageParseQualityAll' });
    const tourTarget = document.querySelector('[data-tour="image-parse-review-batch"]');
    expect(tourTarget).toContainElement(
      screen.getByRole('button', { name: 'imageParseRegenerateAll' }),
    );
    expect(tourTarget).not.toContainElement(filter);
    expect(tourTarget).not.toContainElement(screen.getByRole('tablist'));
    expect(navigation).toContainElement(filter);
    expect(filter).toHaveAttribute('title', 'imageParseQualityAll');
    expect(filter).toHaveAttribute('aria-pressed', 'false');
    expect(filter).not.toHaveTextContent('imageParseQualityAll');
    expect(navigation).toHaveClass('flex-wrap');
    fireEvent.click(filter);
    expect(props.onToggleReviewAll).toHaveBeenCalledOnce();

    view.rerender(
      <Tabs value="review" onValueChange={() => undefined}>
        <ImageParseResultToolbar
          {...props}
          draft={{ ...props.draft, dirty: true }}
          regeneration={regeneration()}
          activeTab="review"
        />
      </Tabs>,
    );
    const resetButton = screen.getByRole('button', { name: 'imageParseResetDraft' });
    expect(resetButton).toBeVisible();
    expect(document.querySelector('[data-result-navigation]')).toContainElement(resetButton);
    expect(document.querySelector('[data-result-commands]')).toBeNull();
    for (const hidden of [
      'imageParseRecognitionSettings',
      'imageParseDisplaySettings',
      'imageParseCopyRegion',
      'imageParseDownload',
    ]) {
      expect(screen.queryByRole('button', { name: hidden })).toBeNull();
    }

    // 批量重生成期间不再额外展示顶部命令行。
    view.rerender(
      <Tabs value="review" onValueChange={() => undefined}>
        <ImageParseResultToolbar
          {...props}
          regeneration={regeneration({ busy: true })}
          activeTab="review"
        />
      </Tabs>,
    );
    expect(document.querySelector('[data-result-commands]')).toBeNull();
    expect(screen.getByRole('button', { name: 'imageParseRegenerating' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'imageParseRegenerateStop' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'imageParseDownload' })).toBeNull();

    view.rerender(
      <Tabs value="preview" onValueChange={() => undefined}>
        <ImageParseResultToolbar {...props} regeneration={regeneration()} activeTab="preview" />
      </Tabs>,
    );
    expect(screen.getByRole('button', { name: 'imageParseDownload' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'imageParseRecognitionSettings' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'imageParseDisplaySettings' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'imageParseCopyRegion' })).toBeNull();
  });

  it('全部筛选状态使用同一图标控件，不显示长文案或重建控件', () => {
    const { rerender } = render(
      <Tabs defaultValue="review">
        <ImageParseResultToolbar {...props} activeTab="review" />
      </Tabs>,
    );
    const filter = screen.getByRole('button', { name: 'imageParseQualityAll' });
    rerender(
      <Tabs defaultValue="review">
        <ImageParseResultToolbar {...props} activeTab="review" reviewAll />
      </Tabs>,
    );
    expect(screen.getByRole('button', { name: 'imageParseQualityOnlySuggested' })).toBe(filter);
    expect(filter).toHaveAttribute('aria-pressed', 'true');
    expect(filter).toHaveAttribute('title', 'imageParseQualityOnlySuggested');
    expect(filter).not.toHaveTextContent('imageParseQualityOnlySuggested');
  });

  it('批量按钮仅显示图标，操作不受列表分页限制，处理中不能重复执行', async () => {
    const user = userEvent.setup();
    const actions = regeneration({ eligibleLowCount: 45 });
    const { rerender } = render(
      <Tabs defaultValue="review">
        <ImageParseResultToolbar {...props} activeTab="review" regeneration={actions} />
      </Tabs>,
    );
    const batch = screen.getByRole('button', { name: 'imageParseRegenerateAll' });
    expect(batch).not.toHaveTextContent('imageParseRegenerateAll');
    expect(batch.querySelector('.lucide-refresh-cw')).toHaveClass('size-4');
    expect(batch).toHaveClass('h-8', 'w-8', 'p-0');
    await user.click(batch);
    expect(actions.regenerateLowBlocks).toHaveBeenCalledOnce();
    rerender(
      <Tabs defaultValue="review">
        <ImageParseResultToolbar
          {...props}
          activeTab="review"
          regeneration={{ ...actions, busy: true }}
        />
      </Tabs>,
    );
    await user.click(screen.getByRole('button', { name: 'imageParseRegenerating' }));
    expect(actions.regenerateLowBlocks).toHaveBeenCalledOnce();
  });

  it.each([
    { busy: false, available: true, hint: 'imageParseRegenerateAll' },
    { busy: true, available: true, hint: 'imageParseRegenerating' },
    { busy: false, available: false, hint: 'imageParseRegenerateSourceMissing' },
  ])('重生成图标在普通、处理与禁用状态均有悬停提示：%j', async (state) => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="review">
        <ImageParseResultToolbar
          {...props}
          activeTab="review"
          regeneration={regeneration({
            busy: state.busy,
            available: state.available,
            eligibleLowCount: 1,
            unavailableReason: state.available ? undefined : 'imageParseRegenerateSourceMissing',
          })}
        />
      </Tabs>,
    );
    const label = state.busy ? 'imageParseRegenerating' : 'imageParseRegenerateAll';
    const batch = screen.getByRole('button', { name: label });
    expect(batch).not.toHaveTextContent(label);
    expect(batch).toHaveAttribute('title', state.hint);
    expect(batch).toHaveClass('bg-primary', 'text-primary-foreground');
    expect(batch.closest('[data-tour="image-parse-review-batch"]')).not.toBeNull();
    expect(batch.querySelector('.lucide-refresh-cw')).toHaveClass('size-4');
    expect(batch.querySelector('.animate-spin')).toBeNull();
    if (state.busy) {
      expect(batch.closest('[data-tour="image-parse-review-batch"]')).toHaveAttribute(
        'aria-busy',
        'true',
      );
    }
    await user.hover(batch.hasAttribute('disabled') ? (batch.parentElement ?? batch) : batch);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(state.hint);
  });

  it.each([
    { eligibleLowCount: 0, available: true, busy: false, loading: false },
    { eligibleLowCount: 1, available: false, busy: false, loading: false },
    { eligibleLowCount: 1, available: true, busy: true, loading: false },
    { eligibleLowCount: 1, available: true, busy: false, loading: true },
  ])('无可用目标或正在处理时批量按钮禁用：%j', ({ loading, ...state }) => {
    render(
      <Tabs defaultValue="review">
        <ImageParseResultToolbar
          {...props}
          loading={loading}
          activeTab="review"
          regeneration={regeneration(state)}
        />
      </Tabs>,
    );
    expect(
      screen.getByRole('button', {
        name: state.busy ? 'imageParseRegenerating' : 'imageParseRegenerateAll',
      }),
    ).toBeDisabled();
  });

  it('没有已评分区块时不显示筛选和批量操作', () => {
    render(
      <Tabs defaultValue="review">
        <ImageParseResultToolbar
          {...props}
          activeTab="review"
          hasScoredBlocks={false}
          regeneration={regeneration()}
        />
      </Tabs>,
    );
    expect(screen.queryByRole('button', { name: 'imageParseQualityAll' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'imageParseRegenerateAll' })).toBeNull();
  });
});
