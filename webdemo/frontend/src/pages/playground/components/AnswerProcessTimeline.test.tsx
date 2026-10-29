import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import '@/i18n';

import { AnswerProcessTimeline } from './AnswerProcessTimeline';

describe('AnswerProcessTimeline', () => {
  it('既无思考也无工具时不渲染任何过程区', () => {
    const { container } = render(<AnswerProcessTimeline reasoning="" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('联网工具与思考同处一条时间线，按发生顺序交错', async () => {
    const user = userEvent.setup();
    render(
      <AnswerProcessTimeline
        reasoning="先搜一下。再读几页。最后整理。"
        streaming={false}
        toolEvents={[
          {
            eventId: 'search-1',
            step: 1,
            tool: 'web_search',
            status: 'success',
            resultCount: 23,
            reasoningOffset: 5,
          },
          {
            eventId: 'read-1',
            step: 2,
            tool: 'web_extractor',
            status: 'success',
            pageCount: 2,
            reasoningOffset: 10,
            citationUrls: ['https://one.example.com/a', 'https://two.example.com/b'],
          },
        ]}
        citations={[
          { url: 'https://one.example.com/a', title: '技术报告' },
          { url: 'https://two.example.com/b', title: '知乎讨论' },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: '已联网检索并思考' }));

    const items = screen.getAllByRole('listitem');
    const heads = ['先搜一下。', '搜索到 23 个网页', '再读几页。', '浏览 2 个页面', '最后整理。'];
    expect(items).toHaveLength(heads.length);
    heads.forEach((head, position) => {
      expect(items[position]?.textContent?.startsWith(head)).toBe(true);
    });
  });

  it('工具事件缺切分点时退化为思考整块置顶，工具依次排在其后', async () => {
    const user = userEvent.setup();
    render(
      <AnswerProcessTimeline
        reasoning="历史消息里的整块思考。"
        streaming={false}
        toolEvents={[{ eventId: 'time-1', step: 1, tool: 'datetime', status: 'success' }]}
      />,
    );

    await user.click(screen.getByRole('button', { name: '已思考' }));

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('历史消息里的整块思考。');
    expect(items[1]).toHaveTextContent('查询当前时间');
  });

  it('搜索进行中就地显示查询词，完成后换成搜到的网页数与站点图标', () => {
    const { rerender } = render(
      <AnswerProcessTimeline
        reasoning=""
        streaming={true}
        toolEvents={[
          {
            eventId: 'search-1',
            step: 1,
            tool: 'web_search',
            status: 'running',
            queries: ['MiniCPM 最新进展'],
          },
        ]}
      />,
    );

    expect(screen.getByRole('button', { name: '正在搜索 MiniCPM 最新进展' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText('搜索')).toBeVisible();
    expect(screen.getByText('MiniCPM 最新进展')).toBeVisible();

    rerender(
      <AnswerProcessTimeline
        reasoning=""
        streaming={false}
        toolEvents={[
          {
            eventId: 'search-1',
            step: 1,
            tool: 'web_search',
            status: 'success',
            resultCount: 23,
            queries: ['MiniCPM 最新进展'],
          },
        ]}
        citations={[
          { url: 'https://one.example.com', title: '来源一' },
          { url: 'https://two.example.com', title: '来源二' },
        ]}
      />,
    );

    expect(screen.getByText('搜索到 23 个网页')).toBeVisible();
    // After completion, do not repeat the query; that space goes to the stacked site icons
    expect(screen.queryByText('MiniCPM 最新进展')).not.toBeInTheDocument();
    const row = screen.getByText(/搜索到 23 个网页/).closest('li');
    expect(row?.querySelectorAll('img')).toHaveLength(2);
  });

  it('整条时间线只有一段思考时不画项目符号，但正文仍与顶行标题左对齐', () => {
    const { container } = render(
      <AnswerProcessTimeline reasoning="只有一段思考。" streaming={false} />,
    );

    // A finished reasoning-only state is collapsed by default and the panel is inert, so a role query misses it → query the DOM directly
    const row = container.querySelector('li');
    expect(row).not.toBeNull();
    // The dot is the only decoration in the marker column; with one row left it points at empty space, with no second item to align to
    expect(row?.querySelector('span[class*="size-1.5"]')).toBeNull();
    // Keep the column itself: removing it shifts the body left into the icon column, so it reads as a peer of the top row
    expect(row).toHaveClass('grid-cols-[1.5rem_minmax(0,1fr)]');
    expect(screen.getByText('只有一段思考。')).toBeInTheDocument();
  });

  it('还有工具行要长出来时保留项目符号，避免圆点中途凭空冒出', () => {
    const { container } = render(
      <AnswerProcessTimeline
        reasoning="先想一下。"
        streaming={true}
        searching={true}
        toolEvents={[]}
      />,
    );

    // Web search is on but the first tool frame has not arrived: items has only one entry then, and deciding by the current count flashes the dot
    expect(container.querySelector('li span[class*="size-1.5"]')).not.toBeNull();
  });

  it('联网取证过的回答与纯思考的回答，顶行文案不同但共用同一枚图标', () => {
    const searched = render(
      <AnswerProcessTimeline
        reasoning="先查一下再答。"
        streaming={false}
        toolEvents={[
          { eventId: 'search-1', step: 1, tool: 'web_search', status: 'success', resultCount: 3 },
        ]}
      />,
    );

    expect(screen.getByRole('button', { name: '已联网检索并思考' })).toBeVisible();
    const searchedIcon = searched.container.querySelector('svg')?.getAttribute('class');
    searched.unmount();

    render(<AnswerProcessTimeline reasoning="先查一下再答。" streaming={false} />);

    expect(screen.getByRole('button', { name: '已思考' })).toBeVisible();
    /*
      The icon is deliberately kept to one: a different icon on every top row in a column of answers turns the stack into colored noise.
      Compare by class that "the two match" rather than hard-asserting a lucide name, so a rename does not fail falsely.
    */
    const reasonedIcon = document.querySelector('svg')?.getAttribute('class');
    expect(searchedIcon).toBeTruthy();
    expect(reasonedIcon).toBe(searchedIcon);
  });

  it('顶行显示成功联网检索的调用次数', () => {
    const { rerender } = render(
      <AnswerProcessTimeline
        reasoning="先查一下再答。"
        streaming={false}
        toolEvents={[
          { eventId: 'search-1', step: 1, tool: 'web_search', status: 'success', resultCount: 3 },
          { eventId: 'search-2', step: 2, tool: 'web_search', status: 'success', resultCount: 5 },
        ]}
      />,
    );

    expect(screen.getByRole('button', { name: '已联网检索 2 次并思考' })).toBeVisible();

    rerender(
      <AnswerProcessTimeline
        reasoning=""
        streaming={false}
        toolEvents={[
          { eventId: 'search-1', step: 1, tool: 'web_search', status: 'success', resultCount: 3 },
          { eventId: 'search-2', step: 2, tool: 'web_search', status: 'success', resultCount: 5 },
        ]}
      />,
    );

    expect(screen.getByRole('button', { name: '已联网检索 2 次' })).toBeVisible();
  });

  it('联网开关开着但模型一次都没调工具时，不谎报已联网', () => {
    render(
      <AnswerProcessTimeline
        reasoning="这个问题我自己就能答。"
        streaming={false}
        searching={false}
      />,
    );

    // The switch only means "web search is allowed." Marking it as already searched makes users think the answer has external evidence, which is worse than no mark.
    expect(screen.getByRole('button', { name: '已思考' })).toBeVisible();
  });

  it('联网搜索失败时不报已联网检索：没取回证据就不算检索过', () => {
    render(
      <AnswerProcessTimeline
        reasoning="试着搜一下。"
        streaming={false}
        toolEvents={[
          {
            eventId: 'search-1',
            step: 1,
            tool: 'web_search',
            status: 'failed',
            message: '上游超时',
          },
        ]}
      />,
    );

    expect(screen.getByRole('button', { name: '联网搜索失败' })).toBeVisible();
  });

  it('搜索行的站点图标只叠 4 个且不报 +N，避免与本行自己的网页数对不上', async () => {
    const user = userEvent.setup();
    render(
      <AnswerProcessTimeline
        reasoning=""
        streaming={false}
        toolEvents={[
          { eventId: 'search-1', step: 1, tool: 'web_search', status: 'success', resultCount: 10 },
        ]}
        citations={Array.from({ length: 30 }, (_, index) => ({
          url: `https://site-${index}.example.com`,
          title: `来源 ${index}`,
        }))}
      />,
    );

    await user.click(screen.getByRole('button', { name: '已联网检索' }));

    const row = screen.getByText(/搜索到 10 个网页/).closest('li');
    expect(row?.querySelectorAll('img')).toHaveLength(4);
    // That stack is an approximation filled from the whole message's sources; +26 would directly contradict "found 10 pages"
    expect(row?.textContent).not.toContain('+');
  });

  it('搜索行整块可点，直接打开来源抽屉', async () => {
    const user = userEvent.setup();
    const onOpenSources = vi.fn();
    render(
      <AnswerProcessTimeline
        reasoning=""
        streaming={false}
        onOpenSources={onOpenSources}
        toolEvents={[
          { eventId: 'search-1', step: 1, tool: 'web_search', status: 'success', resultCount: 2 },
        ]}
        citations={[
          { url: 'https://one.example.com', title: '来源一' },
          { url: 'https://two.example.com', title: '来源二' },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: '已联网检索' }));
    await user.click(screen.getByRole('button', { name: '搜索到 2 个网页，查看来源' }));

    expect(onOpenSources).toHaveBeenCalledTimes(1);
  });

  it('没有来源或上层没给回调时，搜索行退回纯文本不做空按钮', async () => {
    const user = userEvent.setup();
    render(
      <AnswerProcessTimeline
        reasoning=""
        streaming={false}
        toolEvents={[
          { eventId: 'search-1', step: 1, tool: 'web_search', status: 'success', resultCount: 2 },
        ]}
        citations={[{ url: 'https://one.example.com', title: '来源一' }]}
      />,
    );

    const trigger = screen.getByRole('button', { name: '已联网检索' });
    await user.click(trigger);

    expect(screen.getByText('搜索到 2 个网页')).toBeVisible();
    // Only the disclosure-header button is left
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('顶行的搜索词：还没到就退回静态文案，多个用顿号连，过长截断', () => {
    // The query waits until the model finishes generating tool_call arguments and arrives with the running frame; that gap can only show static copy
    const { rerender } = render(
      <AnswerProcessTimeline
        reasoning=""
        streaming={true}
        toolEvents={[{ eventId: 's1', step: 1, tool: 'web_search', status: 'running' }]}
      />,
    );

    expect(screen.getByRole('button', { name: '正在搜索' })).toBeVisible();

    rerender(
      <AnswerProcessTimeline
        reasoning=""
        streaming={true}
        toolEvents={[
          {
            eventId: 's1',
            step: 1,
            tool: 'web_search',
            status: 'running',
            queries: ['北京天气', '上海天气'],
          },
        ]}
      />,
    );

    expect(screen.getByRole('button', { name: '正在搜索 北京天气、上海天气' })).toBeVisible();

    // The model sometimes stuffs a whole sentence into query: the top row is a single line, and without truncation the sentence crowds it out
    rerender(
      <AnswerProcessTimeline
        reasoning=""
        streaming={true}
        toolEvents={[
          {
            eventId: 's1',
            step: 1,
            tool: 'web_search',
            status: 'running',
            queries: ['一二三四五六七八九十一二三四五'],
          },
        ]}
      />,
    );

    expect(
      screen.getByRole('button', { name: '正在搜索 一二三四五六七八九十一二三四…' }),
    ).toBeVisible();
  });

  it('流式期间工具行等到它上方的思考文字播完才出现', () => {
    const toolEvents = [
      {
        eventId: 'search-1',
        step: 1,
        tool: 'web_search',
        status: 'running' as const,
        reasoningOffset: 10,
        queries: ['MiniCPM 最新进展'],
      },
    ];
    const { rerender } = render(
      <AnswerProcessTimeline reasoning="让我先搜一下" streaming={true} toolEvents={toolEvents} />,
    );

    /*
      Reasoning has only played to character 6, and the cut is at character 10: hold the tool row.
      The top row is not held with it — what is held is order inside the timeline; the top row reports the real state right now, and "which query is being searched" is more useful the earlier it appears. So the query is only on the top row at this moment, not in the expanded area.
    */
    expect(screen.getByRole('button', { name: '正在搜索 MiniCPM 最新进展' })).toBeVisible();
    expect(screen.queryByText('MiniCPM 最新进展')).not.toBeInTheDocument();

    rerender(
      <AnswerProcessTimeline
        reasoning="让我先搜一下最新进展"
        streaming={true}
        toolEvents={toolEvents}
      />,
    );

    expect(screen.getByText('MiniCPM 最新进展')).toBeVisible();
  });

  it('读网页行内联出页面标题，标题缺失时退回域名', async () => {
    const user = userEvent.setup();
    render(
      <AnswerProcessTimeline
        reasoning=""
        streaming={false}
        toolEvents={[
          {
            eventId: 'read-1',
            step: 1,
            tool: 'web_extractor',
            status: 'success',
            pageCount: 2,
            citationUrls: ['https://one.example.com/a', 'https://untitled.example.com/b'],
          },
        ]}
        citations={[{ url: 'https://one.example.com/a', title: '技术报告' }]}
      />,
    );

    await user.click(screen.getByRole('button', { name: '已联网检索' }));

    const hit = screen.getByRole('link', { name: '技术报告，打开原文' });
    expect(hit).toHaveAttribute('href', 'https://one.example.com/a');
    expect(hit).toHaveAttribute('target', '_blank');
    // Addresses that miss citations get no invented title; use the domain instead
    expect(screen.getByRole('link', { name: 'untitled.example.com，打开原文' })).toBeVisible();
  });

  it('流式思考默认展开，并使用统一 Markdown 管线渲染行内和块级公式', () => {
    const reasoning = [
      '先计算块级公式：',
      '\\[',
      'S_n = \\sum_{i=1}^{n} i',
      '\\]',
      '',
      '再代入行内公式 \\(S_n = \\frac{n(n+1)}{2}\\)。',
    ].join('\n');
    const { container } = render(<AnswerProcessTimeline reasoning={reasoning} streaming={true} />);

    const trigger = screen.getByRole('button', { name: '正在思考中' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    expect(container.querySelectorAll('.katex-error')).toHaveLength(0);
    expect(container.querySelectorAll('.katex-display')).toHaveLength(1);
    expect(
      Array.from(container.querySelectorAll('.katex')).some(
        (element) => element.closest('.katex-display') === null,
      ),
    ).toBe(true);
    expect(container.textContent).not.toContain('\\[');
    expect(container.textContent).not.toContain('\\]');
    expect(container.textContent).not.toContain('\\(');
    expect(container.textContent).not.toContain('\\)');
  });

  it('流式阶段默认展开思考与工具内容，用户可整体收起', async () => {
    const user = userEvent.setup();
    render(
      <AnswerProcessTimeline
        reasoning="正在核对当前时间。"
        streaming={true}
        toolEvents={[{ eventId: 'time-1', step: 1, tool: 'datetime', status: 'running' }]}
      />,
    );

    // After the merge there is only 1 disclosure button; reasoning and tools both belong to it
    const trigger = screen.getByRole('button', { name: '工具调用中' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('button')).toHaveLength(1);

    expect(screen.getByText('正在核对当前时间。')).toBeVisible();
    expect(screen.getByText('查询当前时间')).toBeVisible();

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => {
      expect(screen.getByText('正在核对当前时间。')).not.toBeVisible();
    });
  });

  it('工具状态文案变化时保持过程行展开宽度稳定', () => {
    const { rerender } = render(
      <AnswerProcessTimeline
        reasoning=""
        streaming={true}
        toolEvents={[{ eventId: 'time-1', step: 1, tool: 'datetime', status: 'running' }]}
      />,
    );

    expect(screen.getByRole('button', { name: '工具调用中' })).toHaveClass('w-full', 'max-w-3xl');

    rerender(
      <AnswerProcessTimeline
        reasoning=""
        streaming={false}
        toolEvents={[
          { eventId: 'time-1', step: 1, tool: 'datetime', status: 'success', durationMs: 120 },
        ]}
      />,
    );

    // Done + tools only (no reasoning): fall back to the tool count, otherwise the collapsed state is a blank line
    expect(screen.getByRole('button', { name: '使用 1 个工具' })).toHaveClass(
      'w-full',
      'max-w-3xl',
    );
  });

  it('流式思考默认渲染，并限制为固定高度滚动区', () => {
    const { container } = render(
      <AnswerProcessTimeline
        reasoning={['第一步分析。', '', '第二步核对。', '', '第三步整理。'].join('\n')}
        streaming={true}
      />,
    );

    expect(screen.getByText(/第一步分析。/)).toBeVisible();
    expect(container.querySelector('[data-reasoning-scroll]')).toHaveClass(
      'max-h-48',
      'overflow-y-auto',
    );
  });

  it('流式思考内容增长时，过程滚动区自动跟随到底部', () => {
    const { container, rerender } = render(
      <AnswerProcessTimeline reasoning="第一段分析。" streaming={true} />,
    );
    const reasoningScroll = container.querySelector('[data-reasoning-scroll]');
    expect(reasoningScroll).not.toBeNull();

    let scrollHeight = 260;
    Object.defineProperty(reasoningScroll, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    });

    rerender(
      <AnswerProcessTimeline
        reasoning={['第一段分析。', '', '第二段分析。', '', '第三段分析。'].join('\n')}
        streaming={true}
      />,
    );

    scrollHeight = 420;
    rerender(
      <AnswerProcessTimeline
        reasoning={[
          '第一段分析。',
          '',
          '第二段分析。',
          '',
          '第三段分析。',
          '',
          '第四段分析。',
        ].join('\n')}
        streaming={true}
      />,
    );

    expect(reasoningScroll?.scrollTop).toBe(420);
  });

  it('收起过程区时把阅读位置归零，下次展开从头读', async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(
      <AnswerProcessTimeline reasoning="第一段分析。" streaming={true} />,
    );
    const reasoningScroll = container.querySelector('[data-reasoning-scroll]');
    Object.defineProperty(reasoningScroll, 'scrollHeight', {
      configurable: true,
      get: () => 420,
    });

    rerender(
      <AnswerProcessTimeline
        reasoning={['第一段分析。', '', '第二段分析。'].join('\n')}
        streaming={true}
      />,
    );
    expect(reasoningScroll?.scrollTop).toBe(420);

    await user.click(screen.getByRole('button', { name: '正在思考中' }));

    // The collapsed state is invisible, so resetting to zero has no visual cost; without it, the next open stops on the tail of the reasoning
    expect(reasoningScroll?.scrollTop).toBe(0);
  });

  it('深思首段在流式阶段到达后，也会启用自动跟随', async () => {
    const { container, rerender } = render(<AnswerProcessTimeline reasoning="" streaming={true} />);

    rerender(<AnswerProcessTimeline reasoning="首段分析。" streaming={true} />);
    await waitFor(() => {
      expect(container.querySelector('[data-reasoning-scroll]')).not.toBeNull();
    });
    const reasoningScroll = container.querySelector('[data-reasoning-scroll]');

    let scrollHeight = 360;
    Object.defineProperty(reasoningScroll, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    });

    scrollHeight = 520;
    rerender(
      <AnswerProcessTimeline
        reasoning={['首段分析。', '', '第二段分析。'].join('\n')}
        streaming={true}
      />,
    );

    expect(reasoningScroll?.scrollTop).toBe(520);
  });

  it('纯思考完成后保持单层展开，顶行只报做了什么', async () => {
    const { rerender } = render(
      <AnswerProcessTimeline reasoning="正在判断问题意图。" streaming={true} />,
    );

    rerender(<AnswerProcessTimeline reasoning="已确认问题意图并整理回答。" streaming={false} />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(screen.getByRole('button', { name: '已思考' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('button', { name: '查看思考过程' })).not.toBeInTheDocument();
    expect(screen.getByText('已确认问题意图并整理回答。')).toBeVisible();
  });

  it('完成后默认收起，展开可见工具行且不再报单步耗时', async () => {
    const user = userEvent.setup();
    render(
      <AnswerProcessTimeline
        reasoning="已完成时间核对。"
        streaming={false}
        toolEvents={[
          { eventId: 'time-1', step: 1, tool: 'datetime', status: 'success', durationMs: 820 },
          { eventId: 'calc-1', step: 2, tool: 'calculator', status: 'success', durationMs: 1_240 },
        ]}
      />,
    );

    const trigger = screen.getByRole('button', { name: '已思考' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('查询当前时间')).not.toBeVisible();
    // Unknown tool names are shown as-is; do not invent Chinese copy
    expect(screen.getByText('calculator')).not.toBeVisible();
    const panel = document.getElementById(trigger.getAttribute('aria-controls') ?? '');
    expect(panel?.firstElementChild).toHaveProperty('inert', true);

    await user.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(panel?.firstElementChild).toHaveProperty('inert', false);
    // Per-step duration is cut, matching competitors; total duration is not reported on this timeline either, because the metrics row under the body already has a copy
    expect(screen.queryByText('用时 0.8 秒')).not.toBeInTheDocument();
    expect(screen.queryByText('用时 1.2 秒')).not.toBeInTheDocument();
  });

  it('用户在流式阶段主动收起后，后续内容更新不会抢占式重新展开', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <AnswerProcessTimeline reasoning="第一段分析。" streaming={true} />,
    );

    const trigger = screen.getByRole('button', { name: '正在思考中' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    rerender(<AnswerProcessTimeline reasoning="第一段分析。第二段分析。" streaming={true} />);

    expect(screen.getByRole('button', { name: '正在思考中' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('非联网工具失败时首屏即展开，但不把整行标红', () => {
    render(
      <AnswerProcessTimeline
        reasoning=""
        streaming={false}
        toolEvents={[
          {
            eventId: 'time-1',
            step: 1,
            tool: 'datetime',
            status: 'failed',
            message: '时间服务不可用',
          },
        ]}
      />,
    );

    const trigger = screen.getByRole('button', { name: '使用 1 个工具' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    // A failed sub-step does not mean the answer is untrustworthy; the title is not turned red and is not replaced with a web-search failure
    expect(trigger).not.toHaveClass('text-destructive');
    expect(screen.getByText('时间服务不可用')).toBeVisible();
  });

  it('联网失败时标题换成后端原因并整行标红', () => {
    render(
      <AnswerProcessTimeline
        reasoning=""
        streaming={false}
        searchStep="failed"
        searchActiveTool="web_search"
        searchStatus="搜索服务暂时不可用"
      />,
    );

    const trigger = screen.getByRole('button', { name: '搜索服务暂时不可用' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveClass('text-destructive');
  });
});
