import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider, TooltipProvider } from '@map/ui';
import '@/i18n';
import { MessageBubble } from './MessageBubble';

/** 助手消息气泡的渲染测试。 */
describe('MessageBubble', () => {
  it('不展示用户消息的上下文隔离提示文案', () => {
    render(
      <MessageBubble
        message={{
          id: 'moderation-request',
          role: 'user',
          content: '被安审拦截的请求',
          contextExcluded: true,
        }}
      />,
    );

    expect(screen.queryByText('该消息未参与后续对话上下文')).not.toBeInTheDocument();
  });

  it('将被安审隔离的安全回答按普通助手正文排版', () => {
    const { container } = render(
      <MessageBubble
        message={{
          id: 'moderation-answer',
          role: 'assistant',
          content: '这条内容暂时无法继续处理，换个话题试试吧。',
          contextExcluded: true,
          errorCode: 'content_policy_violation',
        }}
      />,
    );

    expect(screen.getByText('这条内容暂时无法继续处理，换个话题试试吧。').tagName).toBe('P');
    expect(container.querySelector('.border')).toBeNull();
    expect(container.querySelector('.bg-muted')).toBeNull();
  });

  it('联网与思考合并为一条时间线，只有一个折叠开关', async () => {
    const user = userEvent.setup();
    render(
      <MessageBubble
        message={{
          id: 'with-citations',
          role: 'assistant',
          content: '这是带来源的回答。',
          reasoning: '先检索天气，再核对多个来源。',
          metrics: { durationMs: 3200 },
          searchStep: 'synthesizing',
          toolEvents: [
            {
              eventId: 'search-1',
              step: 1,
              tool: 'web_search',
              status: 'success',
              resultCount: 4,
            },
          ],
          citations: [
            { url: 'https://one.example.com', title: '来源一' },
            { url: 'https://two.example.com', title: '来源二' },
            { url: 'https://three.example.com', title: '来源三' },
            { url: 'https://four.example.com', title: '来源四' },
          ],
        }}
        onOpenCitations={() => undefined}
      />,
    );

    // 过程区只剩一个开关：思考与联网同属一条时间线，顶行只报「做了什么」
    const trigger = screen.getByTestId('process-toggle');
    expect(trigger).toHaveAccessibleName('已联网检索并思考');
    expect(screen.getAllByTestId('process-toggle')).toHaveLength(1);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('这是带来源的回答。')).toBeVisible();

    await user.click(trigger);

    // 一次展开同时看到思考与联网，不用再分别点两处
    expect(screen.getByText('先检索天气，再核对多个来源。')).toBeVisible();
    expect(screen.getByText(/搜索到 4 个网页/)).toBeVisible();
    // 来源统一收在正文下方的胶囊里
    expect(screen.getByTestId('sources-chip')).toHaveTextContent('4 个网页');
  });

  it('搜索进行中就在这条时间线里播报，不另起一张进度卡', () => {
    render(
      <MessageBubble
        message={{
          id: 'searching',
          role: 'assistant',
          content: '',
          streaming: true,
          searching: true,
          searchStep: 'searching',
          searchActiveTool: 'web_search',
          toolEvents: [
            {
              eventId: 'search-1',
              step: 1,
              tool: 'web_search',
              status: 'running',
              queries: ['MiniCPM 最新进展'],
            },
          ],
        }}
      />,
    );

    const trigger = screen.getByTestId('process-toggle');
    // 顶行带上当前搜的词：收起时它是唯一的进度通道，静态文案挂几秒与卡死无从区分
    expect(trigger).toHaveAccessibleName('正在搜索 MiniCPM 最新进展');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    // 查询词同时是进行中工具行的行内后缀，完成后会被「搜索到 N 个网页」取代
    expect(screen.getByText('MiniCPM 最新进展')).toBeVisible();
    // 过程区本身就是状态反馈，其下方不再出现悬空的等待点
    expect(screen.queryByLabelText('正在生成')).not.toBeInTheDocument();
  });

  it('流式结束后过程区原地改标题保持展开，来源收敛成胶囊', async () => {
    const { rerender } = render(
      <MessageBubble
        message={{
          id: 'stream-lifecycle',
          role: 'assistant',
          content: '',
          reasoning: '正在分析搜索结果。',
          streaming: true,
          searching: true,
          searchStep: 'reading',
        }}
      />,
    );

    expect(screen.getByRole('button', { name: '正在搜索' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    const processSection = screen.getByRole('region', { name: '正在搜索' });
    expect(screen.getByText('正在分析搜索结果。')).toBeVisible();

    rerender(
      <MessageBubble
        message={{
          id: 'stream-lifecycle',
          role: 'assistant',
          content: '最终回答。',
          reasoning: '已完成分析。',
          streaming: false,
          searching: false,
          searchStep: 'synthesizing',
          citations: [{ url: 'https://www.openbmb.cn', title: 'OpenBMB' }],
        }}
        onOpenCitations={() => undefined}
      />,
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    // 思考区是同一个 DOM 节点在原地改标题，不重新挂载 → 不会有一次视觉跳动
    expect(screen.getByRole('region', { name: '已思考' })).toBe(processSection);
    expect(screen.getByRole('button', { name: '已思考' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('已完成分析。')).toBeVisible();
    expect(screen.getByTestId('sources-chip')).toHaveTextContent('1 个网页');
    expect(screen.getByText('最终回答。')).toBeVisible();
  });

  it('联网失败时过程块首屏即展开，且不阻断已有回答', () => {
    render(
      <MessageBubble
        message={{
          id: 'search-failed',
          role: 'assistant',
          content: '这是模型已生成的回答。',
          searchStep: 'failed',
          searchStatus: '搜索服务暂时不可用',
        }}
      />,
    );

    // 失败标题直接用后端原因，比"联网搜索失败"更具体
    const trigger = screen.getByRole('button', { name: '搜索服务暂时不可用' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveClass('text-destructive');
    expect(screen.getByText('这是模型已生成的回答。')).toBeVisible();
  });

  it('回答底部来源胶囊报网页数，点击从右侧打开来源抽屉', async () => {
    const user = userEvent.setup();
    const onOpenCitations = vi.fn();
    const citations = [
      { url: 'https://one.example.com', title: '来源一', snippet: '来源一的摘要内容' },
      { url: 'https://two.example.com', title: '来源二' },
    ];
    render(
      <TooltipProvider>
        <ToastProvider>
          <MessageBubble
            message={{
              id: 'citation-actions',
              role: 'assistant',
              content: '回答正文。',
              citations,
            }}
            isLastAssistant={true}
            onRegenerate={() => undefined}
            onFeedback={() => undefined}
            onOpenCitations={onOpenCitations}
          />
        </ToastProvider>
      </TooltipProvider>,
    );

    const chip = screen.getByTestId('sources-chip');
    // 标题、摘要、序号全部让给抽屉，胶囊只报个数
    expect(chip).toHaveTextContent('2 个网页');
    expect(chip).toHaveAccessibleName('2 个网页，查看来源');
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    expect(chip.querySelectorAll('img')).toHaveLength(2);

    await user.click(chip);

    // 不带第三参：只开面板，不定位到某一条
    expect(onOpenCitations).toHaveBeenCalledWith('citation-actions', citations);
  });

  it('点正文角标打开面板并带上该条地址，供面板定位高亮', async () => {
    const user = userEvent.setup();
    const onOpenCitations = vi.fn();
    const citations = [
      { url: 'https://one.example.com', title: '来源一' },
      { url: 'https://two.example.com', title: '来源二' },
    ];
    render(
      <TooltipProvider>
        <ToastProvider>
          <MessageBubble
            message={{
              id: 'citation-badge-activate',
              role: 'assistant',
              content: '第一点如此[1]，第二点则不同[2]。',
              citations,
            }}
            onOpenCitations={onOpenCitations}
          />
        </ToastProvider>
      </TooltipProvider>,
    );

    await user.click(screen.getByRole('link', { name: '第 2 个来源' }));

    // 第三参是被点那条的地址；「查看全部」不带它，两条入口语义由此区分
    expect(onOpenCitations).toHaveBeenCalledWith(
      'citation-badge-activate',
      citations,
      'https://two.example.com',
    );
  });

  it('来源抽屉已打开时，胶囊标注为展开态', () => {
    render(
      <TooltipProvider>
        <ToastProvider>
          <MessageBubble
            message={{
              id: 'citation-panel-open',
              role: 'assistant',
              content: '回答正文。',
              citations: [{ url: 'https://one.example.com', title: '来源一' }],
            }}
            isLastAssistant={true}
            onRegenerate={() => undefined}
            onFeedback={() => undefined}
            onOpenCitations={() => undefined}
            citationsOpen={true}
          />
        </ToastProvider>
      </TooltipProvider>,
    );

    expect(screen.getByTestId('sources-chip')).toHaveAttribute('aria-expanded', 'true');
  });

  it('没有抽屉回调时不渲染来源胶囊，避免点了没反应', () => {
    render(
      <TooltipProvider>
        <ToastProvider>
          <MessageBubble
            message={{
              id: 'citation-card-link',
              role: 'assistant',
              content: '回答正文。',
              citations: [
                {
                  url: 'https://one.example.com/article',
                  title: '来源一',
                  snippet: '来源一的摘要内容',
                },
              ],
            }}
            isLastAssistant={true}
            onRegenerate={() => undefined}
            onFeedback={() => undefined}
          />
        </ToastProvider>
      </TooltipProvider>,
    );

    expect(screen.queryByTestId('sources-chip')).not.toBeInTheDocument();
  });

  it('流式期间不渲染来源胶囊，避免正文边写边重排', () => {
    render(
      <TooltipProvider>
        <ToastProvider>
          <MessageBubble
            message={{
              id: 'citation-streaming',
              role: 'assistant',
              content: '正在写回答',
              streaming: true,
              citations: [{ url: 'https://one.example.com', title: '来源一' }],
            }}
            isLastAssistant={true}
            onRegenerate={() => undefined}
            onFeedback={() => undefined}
            onOpenCitations={() => undefined}
          />
        </ToastProvider>
      </TooltipProvider>,
    );

    expect(screen.queryByTestId('sources-chip')).not.toBeInTheDocument();
  });
});
