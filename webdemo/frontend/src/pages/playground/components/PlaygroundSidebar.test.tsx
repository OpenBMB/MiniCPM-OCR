import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@map/ui';
import { setApplicationLocale } from '@/i18n';
import { PlaygroundSidebar } from './PlaygroundSidebar';
import { PlaygroundHistoryList } from './PlaygroundHistoryList';

const SHARED_EXAMPLES = [
  { id: 'example:mixed', title: '图文文档', category: 'example' as const },
  { id: 'example:invoice', title: '发票', category: 'example' as const },
  { id: 'example:pdf', title: '多页 PDF', category: 'example' as const },
];

function renderSidebar(props: Partial<React.ComponentProps<typeof PlaygroundSidebar>> = {}) {
  const defaults: React.ComponentProps<typeof PlaygroundSidebar> = {
    collapsed: false,
    onToggle: vi.fn(),
    activeExperience: 'language',
    onSelectExperience: vi.fn(),
    sessions: [{ id: 'conv_1', title: '第一条对话' }],
    onSelectSession: vi.fn(),
    onDeleteSession: vi.fn(),
    onNewChat: vi.fn(),
    ...props,
  };
  const view = render(
    <MemoryRouter>
      <TooltipProvider>
        <PlaygroundSidebar {...defaults} />
      </TooltipProvider>
    </MemoryRouter>,
  );
  return { ...defaults, unmount: view.unmount };
}

describe('PlaygroundSidebar 最近对话分页', () => {
  afterEach(async () => {
    await act(async () => {
      await setApplicationLocale('zh-CN');
    });
  });

  it('仅最近对话列表作为独立滚动区域', () => {
    renderSidebar();

    const sessionList = screen.getByRole('region', { name: '最近对话列表' });
    expect(sessionList).toHaveClass('overflow-y-auto', 'overscroll-contain');
    expect(sessionList).not.toContainElement(screen.getByText('模型体验'));
  });

  it('有下一页时展示显式加载更多按钮并触发加载', () => {
    const props = renderSidebar({ hasMore: true, onLoadMore: vi.fn() });
    fireEvent.click(screen.getByRole('button', { name: '加载更多对话' }));
    expect(props.onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('没有下一页时不展示加载更多按钮', () => {
    renderSidebar({ hasMore: false, onLoadMore: vi.fn() });
    expect(screen.queryByRole('button', { name: '加载更多对话' })).not.toBeInTheDocument();
  });

  it('should render English navigation labels after the locale changes', async () => {
    await setApplicationLocale('en-US');

    renderSidebar({
      hasTtsModels: true,
      hasRealtimeModels: true,
      hasImageParseModels: true,
      hasMore: true,
      onLoadMore: vi.fn(),
    });

    expect(screen.getByText('Language models')).toBeInTheDocument();
    expect(screen.getByText('Text to Speech')).toBeInTheDocument();
    expect(screen.getByText('Realtime Audio & Video')).toBeInTheDocument();
    expect(screen.getByText('Image Document Parsing')).toBeInTheDocument();
    expect(screen.getByText('Key information extraction')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Recent conversations' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load more conversations' })).toBeInTheDocument();
  });

  it('无文档解析模型权限时不展示文档解析入口', () => {
    renderSidebar({ hasTtsModels: true, hasRealtimeModels: true });
    expect(screen.queryByText('图片文档解析')).not.toBeInTheDocument();
    expect(screen.queryByText('关键信息抽取')).not.toBeInTheDocument();
  });

  it('有文档解析模型权限时展示入口并使用扫描图标', () => {
    renderSidebar({ hasImageParseModels: true });
    expect(screen.getByText('图片文档解析')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '图片文档解析' }).querySelector('.lucide-scan-text'),
    ).toBeInTheDocument();
  });

  it('selects document parsing from the experience list', () => {
    const props = renderSidebar({ hasImageParseModels: true });
    fireEvent.click(screen.getByRole('button', { name: '图片文档解析' }));
    expect(props.onSelectExperience).toHaveBeenCalledWith('image-parse');
  });

  it('有文档解析模型权限时展示关键信息抽取入口', () => {
    const props = renderSidebar({ hasImageParseModels: true });
    fireEvent.click(screen.getByRole('button', { name: '关键信息抽取' }));
    expect(props.onSelectExperience).toHaveBeenCalledWith('field-extract');
  });

  it('实时音视频入口使用电话图标', () => {
    renderSidebar({ hasRealtimeModels: true });

    const realtimeItem = screen.getByText('实时音视频').closest('button');
    expect(realtimeItem).not.toBeNull();
    expect(realtimeItem?.querySelector('.lucide-phone')).toBeInTheDocument();
  });

  it('OCR 历史直接使用与最近对话相同的左侧列表，不打开历史弹窗', () => {
    const history = {
      sessions: [{ id: 'ocr_1', title: '发票.pdf' }],
      activeSessionId: 'ocr_1',
      onSelectSession: vi.fn(),
      onDeleteSession: vi.fn(),
      onNewChat: vi.fn(),
    };
    renderSidebar({ activeExperience: 'image-parse', imageParseHistory: history });
    const list = screen.getByRole('region', { name: '文档识别历史列表' });
    expect(list).toHaveClass('overflow-visible');
    expect(list).not.toHaveClass('overflow-y-auto', 'overscroll-contain');
    expect(list.closest('[data-history-scroll]')).toHaveClass(
      'overflow-y-auto',
      'overscroll-contain',
    );
    expect(list).not.toContainElement(screen.getByText('模型体验'));
    const entry = screen.getByRole('button', { name: '打开 发票.pdf' });
    expect(entry).toHaveAttribute('aria-current', 'true');
    fireEvent.click(entry);
    expect(history.onSelectSession).toHaveBeenCalledWith('ocr_1');
    fireEvent.click(screen.getByRole('button', { name: '删除 发票.pdf 的记录' }));
    expect(history.onDeleteSession).toHaveBeenCalledWith('ocr_1');
    expect(history.onSelectSession).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '新建识别' }));
    expect(history.onNewChat).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: '历史记录' })).not.toBeInTheDocument();
    expect(screen.queryByText('第一条对话')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('OCR 历史恢复期间在对应行显示加载状态且不阻塞切换', () => {
    const history = {
      sessions: [
        { id: 'ocr_1', title: '大文件.pdf' },
        { id: 'ocr_2', title: '扫描.png' },
      ],
      pendingSessionId: 'ocr_1',
      onSelectSession: vi.fn(),
      onDeleteSession: vi.fn(),
      onNewChat: vi.fn(),
    } satisfies NonNullable<React.ComponentProps<typeof PlaygroundSidebar>['imageParseHistory']>;
    renderSidebar({ activeExperience: 'image-parse', imageParseHistory: history });
    const pendingRow = screen.getByRole('button', { name: '打开 大文件.pdf' });
    const idleRow = screen.getByRole('button', { name: '打开 扫描.png' });
    expect(pendingRow.querySelector('.lucide-loader-circle')).toBeVisible();
    expect(idleRow.querySelector('.lucide-loader-circle')).toBeNull();
    expect(screen.getByRole('region', { name: '文档识别历史列表' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    fireEvent.click(idleRow);
    expect(history.onSelectSession).toHaveBeenCalledWith('ocr_2');
  });

  it('菜单不展示案例分组，仅保留可打开和删除的个人历史', () => {
    const history = {
      sessions: [{ id: 'document', title: 'PS-01.pdf' }, ...SHARED_EXAMPLES],
      activeSessionId: 'example:pdf',
      onSelectSession: vi.fn(),
      onDeleteSession: vi.fn(),
      onNewChat: vi.fn(),
    };
    renderSidebar({ activeExperience: 'image-parse', imageParseHistory: history });
    const records = screen.getByRole('region', { name: '文档识别历史列表' });
    expect(screen.queryByRole('region', { name: '文档案例列表' })).not.toBeInTheDocument();
    expect(screen.queryByText('案例')).not.toBeInTheDocument();
    for (const example of SHARED_EXAMPLES) {
      expect(screen.queryByText(example.title)).not.toBeInTheDocument();
    }
    expect(within(records).getAllByRole('button', { name: /^打开 / })).toHaveLength(1);
    fireEvent.click(within(records).getByRole('button', { name: '打开 PS-01.pdf' }));
    expect(history.onSelectSession).toHaveBeenCalledExactlyOnceWith('document');
    fireEvent.click(within(records).getByRole('button', { name: '删除 PS-01.pdf 的记录' }));
    expect(history.onDeleteSession).toHaveBeenCalledExactlyOnceWith('document');
    expect(screen.getAllByRole('button', { name: '新建识别' })).toHaveLength(1);
    expect(document.querySelectorAll('[data-tour="image-parse-history"]')).toHaveLength(1);
  });

  it('长 OCR 历史保留唯一滚动容器和分页，不混入案例', () => {
    renderSidebar({
      activeExperience: 'image-parse',
      hasImageParseModels: true,
      imageParseHistory: {
        sessions: [
          ...SHARED_EXAMPLES,
          ...Array.from({ length: 30 }, (_, index) => ({
            id: `document-${index}`,
            title: `scan-${index}.pdf`,
          })),
        ],
        onSelectSession: vi.fn(),
        onDeleteSession: vi.fn(),
        onNewChat: vi.fn(),
        hasMore: true,
        onLoadMore: vi.fn(),
      },
    });
    const records = screen.getByRole('region', { name: '文档识别历史列表' });
    const scroller = records.closest('[data-history-scroll]')!;
    expect(screen.queryByRole('region', { name: '文档案例列表' })).not.toBeInTheDocument();
    expect(scroller).toHaveClass('min-h-0', 'overflow-y-auto', 'overscroll-contain');
    expect(scroller.querySelectorAll('.overflow-y-auto, .overscroll-contain')).toHaveLength(0);
    expect(records).toHaveClass('overflow-visible');
    expect(records.parentElement).toHaveClass('shrink-0');
    expect(within(records).getAllByRole('button', { name: /^打开 / })).toHaveLength(30);
    expect(scroller).toContainElement(screen.getByRole('button', { name: '加载更多对话' }));
    expect(scroller).not.toContainElement(screen.getByRole('button', { name: '图片文档解析' }));
  });

  it.each([false, true])('OCR 云端历史暂不可用时不显示通用警告，loading=%s', (loading) => {
    const history = {
      sessions: [{ id: 'ocr_1', title: 'scan.png' }],
      loading,
      storageError: 'imageParseHistoryStorageError',
      onSelectSession: vi.fn(),
      onDeleteSession: vi.fn(),
      onNewChat: vi.fn(),
    };
    renderSidebar({
      activeExperience: 'image-parse',
      imageParseHistory: history,
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '文档识别历史列表' })).toHaveAttribute(
      'aria-busy',
      String(loading),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('云端历史暂不可用，识别不受影响。')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开 scan.png' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '打开 scan.png' }));
    expect(history.onSelectSession).toHaveBeenCalledWith('ocr_1');
    fireEvent.click(screen.getByRole('button', { name: '删除 scan.png 的记录' }));
    expect(history.onDeleteSession).toHaveBeenCalledWith('ocr_1');
    fireEvent.click(screen.getByRole('button', { name: '新建识别' }));
    expect(history.onNewChat).toHaveBeenCalledOnce();
  });

  it('OCR 首次云端历史读取失败不显示通用警告，也不误报历史为空', () => {
    renderSidebar({
      activeExperience: 'image-parse',
      imageParseHistory: {
        sessions: SHARED_EXAMPLES,
        storageError: 'imageParseHistoryStorageError',
        onSelectSession: vi.fn(),
        onDeleteSession: vi.fn(),
        onNewChat: vi.fn(),
      },
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('暂无识别任务')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打开 发票' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建识别' })).toBeVisible();
  });

  it('OCR 文档过大等具体保存错误仍显示警告', () => {
    renderSidebar({
      activeExperience: 'image-parse',
      imageParseHistory: {
        sessions: [{ id: 'ocr_1', title: 'scan.png' }],
        storageError: 'imageParseHistoryTooLarge',
        onSelectSession: vi.fn(),
        onDeleteSession: vi.fn(),
        onNewChat: vi.fn(),
      },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('文档存档超过 128 MB');
    expect(screen.getByRole('button', { name: '打开 scan.png' })).toBeVisible();
  });

  it('OCR 旧记录迁移失败显示可重试说明，不渲染识别失败警告', () => {
    renderSidebar({
      activeExperience: 'image-parse',
      imageParseHistory: {
        sessions: [{ id: 'ocr_1', title: 'scan.png' }, ...SHARED_EXAMPLES],
        storageNotice: 'imageParseHistoryMigrationPending',
        onSelectSession: vi.fn(),
        onDeleteSession: vi.fn(),
        onNewChat: vi.fn(),
      },
    });
    expect(screen.getByRole('status')).toHaveTextContent('尚未同步到云端');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开 scan.png' })).toBeInTheDocument();
  });

  it('个人历史首次加载时不展示案例，保留加载提示', () => {
    renderSidebar({
      activeExperience: 'image-parse',
      imageParseHistory: {
        sessions: SHARED_EXAMPLES,
        loading: true,
        onSelectSession: vi.fn(),
        onDeleteSession: vi.fn(),
        onNewChat: vi.fn(),
      },
    });
    expect(screen.getByRole('status')).toHaveTextContent('正在读取历史记录');
    expect(screen.getByRole('region', { name: '文档识别历史列表' })).toHaveTextContent(
      '正在读取历史记录',
    );
    expect(screen.getByRole('region', { name: '文档识别历史列表' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.queryByRole('button', { name: '打开 发票' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '文档案例列表' })).not.toBeInTheDocument();
  });

  it('英文界面同样移除案例分组，个人历史为空时显示空态', async () => {
    await setApplicationLocale('en-US');
    renderSidebar({
      activeExperience: 'image-parse',
      imageParseHistory: {
        sessions: SHARED_EXAMPLES,
        onSelectSession: vi.fn(),
        onDeleteSession: vi.fn(),
        onNewChat: vi.fn(),
      },
    });
    expect(screen.queryByText('Examples')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Document example list' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open 发票' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Document recognition history' })).toHaveTextContent(
      'No recognition tasks yet',
    );
  });

  it('OCR 首次读取没有缓存条目时仍显示加载提示', () => {
    renderSidebar({
      activeExperience: 'image-parse',
      imageParseHistory: {
        sessions: [],
        loading: true,
        onSelectSession: vi.fn(),
        onDeleteSession: vi.fn(),
        onNewChat: vi.fn(),
      },
    });
    expect(screen.getByRole('status')).toHaveTextContent('正在读取历史记录');
    expect(screen.queryByText('暂无识别任务')).not.toBeInTheDocument();
  });

  it('语言历史后台刷新同样保留固定布局，不展示额外加载行', () => {
    const history = {
      sessions: [{ id: 'conversation', title: '已读取对话' }],
      loading: true,
      onSelectSession: vi.fn(),
      onDeleteSession: vi.fn(),
      onNewChat: vi.fn(),
    };
    render(
      <TooltipProvider>
        <PlaygroundHistoryList kind="language" {...history} />
      </TooltipProvider>,
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '最近对话列表' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByRole('button', { name: '已读取对话' })).toBeInTheDocument();
  });

  it('折叠 OCR 侧栏不展示独立历史按钮或列表', () => {
    renderSidebar({ activeExperience: 'image-parse', collapsed: true });
    expect(screen.queryByRole('region', { name: '文档识别历史列表' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '历史记录' })).not.toBeInTheDocument();
  });

  it('OCR 与语言模型的历史保持相同行样式和选中态，仅滚动容器归属不同', () => {
    const language = renderSidebar({ activeSessionId: 'conv_1' });
    const conversation = screen.getByRole('button', { name: '第一条对话' });
    const rowClass = conversation.closest('[data-history-row]')?.className;
    const buttonClass = conversation.className;
    expect(screen.getByRole('region', { name: '最近对话列表' })).toHaveClass('overflow-y-auto');
    language.unmount();
    renderSidebar({
      activeExperience: 'image-parse',
      imageParseHistory: {
        sessions: [{ id: 'ocr_1', title: 'scan.png' }],
        activeSessionId: 'ocr_1',
        onSelectSession: vi.fn(),
        onDeleteSession: vi.fn(),
        onNewChat: vi.fn(),
      },
    });
    const document = screen.getByRole('button', { name: '打开 scan.png' });
    expect(document.closest('[data-history-row]')?.className).toBe(rowClass);
    expect(document.className).toBe(buttonClass);
    expect(screen.getByRole('region', { name: '文档识别历史列表' })).toHaveClass(
      'overflow-visible',
    );
  });
});
