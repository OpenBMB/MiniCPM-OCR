import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Tabs } from '@map/ui';

import type { useImageParse } from '../../hooks/useImageParse';
import { ImageParseResultPane } from './ImageParseResultPane';
import { ImageParseResultToolbar } from './ImageParseResultToolbar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { label?: string }) =>
      options?.label ? `${key}:${options.label}` : key,
  }),
}));

const INFO_LABEL = 'imageParseOptionInfo:imageParseInlineEditor';
const parse = {
  resultKey: 'edit-hint',
  mode: 'standard',
  markdown: '# document',
  loading: false,
  layout: [],
  crops: [],
} as unknown as ReturnType<typeof useImageParse>;
const draft = {
  value: parse.markdown,
  dirty: false,
  ranges: new Map(),
  setValue: vi.fn(),
  reset: vi.fn(),
};

describe('编辑说明悬停提示', () => {
  it('源码区不再常驻说明，仍可直接编辑草稿', () => {
    render(<ImageParseResultPane parse={parse} draft={draft} tab="source" />);

    expect(screen.queryByText('imageParseEditHint')).not.toBeInTheDocument();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    const source = screen.getByRole('textbox', { name: 'imageParseSource' });
    expect(source).not.toHaveAttribute('readonly');
    fireEvent.change(source, { target: { value: '# updated' } });
    expect(draft.setValue).toHaveBeenCalledExactlyOnceWith('# updated');
  });

  it.each(['preview', 'source'])('%s 视图可悬停源码标签旁的图标查看编辑说明', async (tab) => {
    const user = userEvent.setup();
    render(<ImageParseResultPane parse={parse} draft={draft} tab={tab} />);

    const info = screen.getByRole('button', { name: INFO_LABEL });
    const sourceTab = screen.getByRole('tab', { name: 'imageParseSource' });
    expect(document.querySelector('[data-result-navigation]')).toContainElement(info);
    expect(sourceTab.nextElementSibling).toBe(info);
    expect(screen.queryByText('imageParseEditHint')).not.toBeInTheDocument();
    await user.hover(info);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('imageParseEditHint');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('键盘聚焦可查看提示，Escape 可关闭', async () => {
    const user = userEvent.setup();
    render(<ImageParseResultPane parse={parse} draft={draft} tab="source" />);

    await user.tab();
    expect(screen.getByRole('tab', { name: 'imageParseSource' })).toHaveFocus();
    await user.tab();
    const info = screen.getByRole('button', { name: INFO_LABEL });
    expect(info).toHaveFocus();
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('imageParseEditHint');
    expect(info).toHaveAttribute('aria-describedby', tooltip.id);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('生成中说明改为按需提示，源码保持只读', async () => {
    const user = userEvent.setup();
    render(<ImageParseResultPane parse={{ ...parse, loading: true }} draft={draft} tab="source" />);

    expect(screen.getByRole('textbox', { name: 'imageParseSource' })).toHaveAttribute('readonly');
    expect(screen.queryByText('documentWaitToEdit')).not.toBeInTheDocument();
    await user.hover(screen.getByRole('button', { name: INFO_LABEL }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('documentWaitToEdit');
  });

  it.each([
    { activeTab: 'review', reviewEnabled: true, documentCommands: true },
    { activeTab: 'preview', reviewEnabled: false, documentCommands: false },
  ])('非文档编辑场景不展示双击编辑提示：%j', (options) => {
    render(
      <Tabs value={options.activeTab}>
        <ImageParseResultToolbar
          loading={false}
          reviewCount={0}
          draft={draft}
          linked
          {...options}
        />
      </Tabs>,
    );

    expect(screen.queryByRole('button', { name: INFO_LABEL })).not.toBeInTheDocument();
  });
});
