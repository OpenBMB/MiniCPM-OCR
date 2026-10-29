import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Tabs, ToastProvider } from '@map/ui';
import { useAppStore } from '@map/store';

import { ImageParseResultToolbar } from './ImageParseResultToolbar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
  }),
}));

const props = {
  loading: false,
  reviewCount: 0,
  draft: { value: '', dirty: false, ranges: new Map(), setValue: vi.fn(), reset: vi.fn() },
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
};

function tableMerge(overrides = {}) {
  return {
    status: 'idle' as 'idle' | 'merging' | 'merged',
    pages: [] as number[],
    enabled: true,
    available: true,
    merge: vi.fn().mockResolvedValue(3),
    unmerge: vi.fn(),
    ...overrides,
  };
}

function renderToolbar(extra = {}) {
  return render(
    <ToastProvider>
      <Tabs defaultValue="preview">
        <ImageParseResultToolbar {...props} {...extra} />
      </Tabs>
    </ToastProvider>,
  );
}

describe('结果工具栏：页眉页脚屏蔽', () => {
  beforeEach(() =>
    useAppStore.getState().setPlaygroundPrefs({ imageParseHideHeaderFooter: false }),
  );

  it('点击切换持久化偏好，按下态与文案随之变化', async () => {
    renderToolbar();
    await userEvent.click(screen.getByRole('button', { name: 'imageParseDisplaySettings' }));
    const hide = screen.getByRole('menuitemcheckbox', { name: 'imageParseHideHeaderFooter' });
    await userEvent.click(hide);
    expect(useAppStore.getState().playground.imageParseHideHeaderFooter).toBe(true);
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'imageParseShowHeaderFooter' }),
    ).toBeInTheDocument();
  });
});

describe('结果工具栏：跨页表格合并', () => {
  it('合并按钮始终展示可见文字，不只依赖提示', () => {
    renderToolbar({ tableMerge: tableMerge() });
    const button = screen.getByRole('button', { name: /imageParseMergeTables/ });
    expect(button).toHaveTextContent('imageParseMergeTables');
    expect(button).toHaveClass('h-8');
  });

  it('悬停使用应用内提示，不再触发浏览器原生 title', async () => {
    renderToolbar({ tableMerge: tableMerge() });
    const button = screen.getByRole('button', { name: /imageParseMergeTables/ });
    expect(button).not.toHaveAttribute('title');
    await userEvent.hover(button);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('imageParseMergeTablesHint');
  });

  it('单图 / 单页没有合并按钮', () => {
    renderToolbar();
    expect(screen.queryByRole('button', { name: /imageParseMergeTables/ })).toBeNull();
  });

  it('识别未完成时按钮禁用并提示稍后可用', async () => {
    renderToolbar({ tableMerge: tableMerge({ available: false }) });
    const button = screen.getByRole('button', { name: /imageParseMergeTables/ });
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute('title');
    await userEvent.hover(button.parentElement!);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('imageParseMergeTablesPending');
  });

  it('构建开关关闭时不渲染合并入口', () => {
    renderToolbar({ tableMerge: tableMerge({ enabled: false }) });
    expect(screen.queryByRole('button', { name: /imageParseMergeTables/ })).toBeNull();
  });

  it('合并中显示「合并中」并禁用，避免重复提交', () => {
    renderToolbar({ tableMerge: tableMerge({ status: 'merging' }) });
    const button = screen.getByRole('button', { name: /imageParseMergingTables/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button.querySelector('.animate-spin')).not.toBeNull();
  });

  it('点击合并后用 toast 告知合并了几处', async () => {
    const merge = tableMerge();
    renderToolbar({ tableMerge: merge });
    await userEvent.click(screen.getByRole('button', { name: /imageParseMergeTables/ }));
    expect(merge.merge).toHaveBeenCalledOnce();
    expect(await screen.findByText('imageParseTablesMerged:3')).toBeInTheDocument();
  });

  it('没有可合并的表格时如实告知', async () => {
    renderToolbar({ tableMerge: tableMerge({ merge: vi.fn().mockResolvedValue(0) }) });
    await userEvent.click(screen.getByRole('button', { name: /imageParseMergeTables/ }));
    expect(await screen.findByText('imageParseNoCrossPageTables')).toBeInTheDocument();
  });

  it('合并失败给出错误提示', async () => {
    renderToolbar({ tableMerge: tableMerge({ merge: vi.fn().mockRejectedValue(new Error('x')) }) });
    await userEvent.click(screen.getByRole('button', { name: /imageParseMergeTables/ }));
    await waitFor(() =>
      expect(screen.getByText('imageParseMergeTablesFailed')).toBeInTheDocument(),
    );
  });

  it('合并后变成「取消合并」，点击撤销', async () => {
    const merge = tableMerge({ status: 'merged', pages: [2, 3] });
    renderToolbar({ tableMerge: merge });
    const button = screen.getByRole('button', { name: /imageParseUnmergeTables/ });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(button);
    expect(merge.unmerge).toHaveBeenCalledOnce();
    expect(await screen.findByText('imageParseTablesUnmerged')).toBeInTheDocument();
  });
});

describe('结果工具栏：单图表格合并', () => {
  it('单图使用独立文案，合并后仍可撤销', async () => {
    const merge = tableMerge({ scope: 'singleImage' });
    const initial = renderToolbar({ tableMerge: merge });

    const button = screen.getByRole('button', { name: /imageParseMergeImageTables/ });
    expect(button).not.toHaveAttribute('title');
    await userEvent.hover(button);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('imageParseMergeImageTablesHint');

    initial.unmount();
    const merged = tableMerge({ scope: 'singleImage', status: 'merged' });
    renderToolbar({ tableMerge: merged });
    const unmerge = screen.getByRole('button', { name: /imageParseUnmergeTables/ });
    await userEvent.click(unmerge);
    expect(merged.unmerge).toHaveBeenCalledOnce();
    expect(await screen.findByText('imageParseTablesUnmerged')).toBeInTheDocument();
  });
});
