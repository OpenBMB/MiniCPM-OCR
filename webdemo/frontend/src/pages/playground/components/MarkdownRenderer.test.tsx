import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@map/ui';

import '@/i18n';

import { MarkdownRenderer, shouldDeferMarkdown } from './MarkdownRenderer';

describe('OCR HTML 表格预览', () => {
  const table =
    '<table><tr><td>序号</td><td>公司名称</td></tr><tr><td>30</td><td>上海证券</td></tr></table>';

  it('将 OCR 的紧凑 HTML 表格渲染为单元格，保留后续正文', () => {
    const { container } = render(
      <MarkdownRenderer variant="document" content={`${table}\n\n## 公司主营业务介绍`} />,
    );

    expect(container.querySelectorAll('[data-document-table] table')).toHaveLength(1);
    expect(container.querySelectorAll('tr')).toHaveLength(2);
    expect(container.querySelectorAll('td')).toHaveLength(4);
    expect(container.querySelector('td')?.textContent).toBe('序号');
    expect(container.querySelector('h2')).toHaveTextContent('公司主营业务介绍');
    expect(container.textContent).not.toContain('<table>');
  });

  it('保留合并单元格、换行与 HTML 实体', () => {
    const { container } = render(
      <MarkdownRenderer
        variant="document"
        content={
          '<table><tr><th colspan="2">A &amp; B</th></tr><tr><td rowspan="2">第一行<br>第二行</td><td>1</td></tr><tr><td>2</td></tr></table>'
        }
      />,
    );

    expect(container.querySelector('th')).toHaveAttribute('colspan', '2');
    expect(container.querySelector('td')).toHaveAttribute('rowspan', '2');
    expect(container.querySelector('td br')).not.toBeNull();
    expect(container.querySelector('th')).toHaveTextContent('A & B');
  });

  it.each(['<br>', '<br/>', '<br />', '&lt;br&gt;', '&lt;br /&gt;', '&#60;BR&#62;'])(
    'OCR 表格中的 %s 渲染为换行，兼容可编辑预览',
    (lineBreak) => {
      const cell = `记录内容${lineBreak}施工记录${lineBreak}人员安排`;
      const tables = [`<table><tr><td>${cell}</td></tr></table>`, `| 内容 |\n| --- |\n| ${cell} |`];
      for (const content of tables) {
        const range = { start: 0, end: content.length };
        const { container, unmount } = render(
          <MarkdownRenderer
            variant="document"
            content={content}
            editableBlocks
            highlightRange={range}
            linkedRanges={[{ id: 'ocr-table', range }]}
          />,
        );
        expect(container.querySelectorAll('td br')).toHaveLength(2);
        expect(container.querySelector('td')?.textContent).toBe('记录内容施工记录人员安排');
        expect(container.querySelector('[data-document-table]')).toHaveAttribute(
          'data-ocr-block-id',
          'ocr-table',
        );
        expect(container.querySelector('[data-document-table]')).toHaveAttribute(
          'data-ocr-highlight',
          'true',
        );
        unmount();
      }
    },
  );

  it.each(['<br>', '&lt;br&gt;'])('普通正文中的 %s 渲染为换行，不把标签暴露给用户', (tag) => {
    const { container } = render(
      <MarkdownRenderer variant="document" content={`第一行${tag}第二行`} />,
    );

    expect(container.querySelectorAll('p br')).toHaveLength(1);
    expect(container.textContent).not.toContain('<br>');
  });

  it('正文中的双层转义 br 兼容 Markdown 解码后仍渲染为换行', () => {
    const content = '第一行&amp;lt;br&amp;gt;第二行';
    const { container } = render(<MarkdownRenderer variant="document" content={content} />);

    expect(container.querySelector('p br')).not.toBeNull();
    expect(container.textContent).not.toContain('<br>');
    expect(container.textContent).not.toContain('&lt;br&gt;');
  });

  it('换行兼容不解析代码示例或其他转义 HTML，不影响聊天预览', () => {
    const content =
      '| 内容 |\n| --- |\n| 记录&lt;br&gt;正文 `示例<br>` &lt;img src=x onerror=alert(1)&gt; |' +
      '\n\n```html\n示例<br>&lt;br&gt;\n```';
    const { container, rerender } = render(
      <MarkdownRenderer variant="document" content={content} />,
    );

    expect(container.querySelectorAll('td br')).toHaveLength(1);
    expect(container.querySelector('td code')).toHaveTextContent('示例<br>');
    expect(container.querySelector('pre code')).toHaveTextContent('示例<br>&lt;br&gt;');
    expect(container.querySelector('img, [onerror]')).toBeNull();
    expect(container.querySelector('td')).toHaveTextContent('<img src=x onerror=alert(1)>');

    rerender(<MarkdownRenderer content="记录&lt;br&gt;正文" />);
    expect(container.querySelector('br')).toBeNull();
    expect(container.textContent).toBe('记录<br>正文');
  });

  it.each([table, '| 项目 | 数量 |\n| --- | --- |\n| 实测 | 7 |'])(
    '文档表格只使用单元格网格，不叠加圆角容器边框',
    (content) => {
      const { container } = render(<MarkdownRenderer variant="document" content={content} />);
      const shell = container.querySelector('[data-document-table]');
      expect(shell).not.toHaveClass('border', 'rounded-lg');
      expect(shell).toHaveClass('overflow-x-auto');
      expect(shell?.querySelector('table')).toHaveClass('border-collapse');
    },
  );

  it('过滤脚本、事件属性、危险链接和用户注入的定位标记', () => {
    const { container } = render(
      <MarkdownRenderer
        variant="document"
        content={
          '<table onclick="alert(1)" data-ocr-block-id="fake" style="position:fixed"><tr><td>正文<script>alert(1)</script><iframe src="https://example.test"></iframe><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">链接</a></td></tr></table>'
        }
      />,
    );

    expect(container.querySelector('table')).not.toBeNull();
    expect(
      container.querySelector('script, iframe, [onclick], [onerror], [style], [data-ocr-block-id]'),
    ).toBeNull();
    expect(container.querySelector('a')).not.toHaveAttribute('href');
    expect(container.textContent).not.toContain('alert(1)');
  });

  it('HTML 表格仍能高亮并定位到对应原图区块', () => {
    const range = { start: 0, end: table.length };
    const { container } = render(
      <MarkdownRenderer
        variant="document"
        content={table}
        highlightRange={range}
        linkedRanges={[{ id: 'ocr-table', range }]}
      />,
    );

    expect(container.querySelector('[data-document-table]')).toHaveAttribute(
      'data-ocr-highlight',
      'true',
    );
    expect(container.querySelector('[data-document-table]')).toHaveAttribute(
      'data-ocr-block-id',
      'ocr-table',
    );
  });

  it('文档预览仍支持 GFM 表格、任务列表、代码高亮和数学公式', () => {
    const { container } = render(
      <MarkdownRenderer
        variant="document"
        content={
          '| 项目 | 数量 |\n| --- | --- |\n| 实测 | 7 |\n\n- [x] 完成\n\n```js\nconst x = 1;\n```\n\n$a^2$\n\n$$b^2$$'
        }
      />,
    );

    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelector('[role="checkbox"]')).toHaveAttribute('aria-checked', 'true');
    expect(container.querySelector('.hljs')).not.toBeNull();
    expect(container.querySelectorAll('.katex')).toHaveLength(2);
  });

  it('聊天默认预览及代码块继续将 HTML 当作文本展示', () => {
    const { container, rerender } = render(<MarkdownRenderer content={table} />);
    expect(container.querySelector('table')).toBeNull();
    expect(container).toHaveTextContent('<table>');

    rerender(<MarkdownRenderer variant="document" content={`\`\`\`html\n${table}\n\`\`\``} />);
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('code')).toHaveTextContent('<table>');
  });
});

describe('shouldDeferMarkdown', () => {
  it('长回答完成后启用懒渲染', () => {
    expect(shouldDeferMarkdown(12_001, false)).toBe(true);
  });

  it('流式回答不懒渲染，保证内容实时可见', () => {
    expect(shouldDeferMarkdown(50_000, true)).toBe(false);
  });

  it('普通长度回答直接渲染', () => {
    expect(shouldDeferMarkdown(12_000, false)).toBe(false);
  });

  it('把模型输出的独占行裸 LaTeX 渲染为 KaTeX 公式', () => {
    const { container } = render(
      <MarkdownRenderer content={'最终答案：\n\nx = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}'} />,
    );

    expect(container.querySelector('.katex-display')).not.toBeNull();
  });

  it('流式期间不推测裸公式，完成后再渲染完整裸公式', () => {
    const content = 'x = \\frac{a}{b}';
    const { container, rerender } = render(<MarkdownRenderer content={content} streaming />);

    expect(container.querySelector('.katex')).toBeNull();
    expect(container).toHaveTextContent(content);

    rerender(<MarkdownRenderer content={content} streaming={false} />);

    expect(container.querySelector('.katex-display')).not.toBeNull();
  });

  it('同一回答可混合渲染行内公式、裸等式和任意 KaTeX 环境', () => {
    const { container } = render(
      <MarkdownRenderer
        content={[
          '行内公式：\\(a^2+b^2=c^2\\)。',
          '',
          'E = mc^2',
          '',
          '\\begin{array}{cc}',
          'a & b \\\\',
          'c & d',
          '\\end{array}',
        ].join('\n')}
      />,
    );

    expect(container.querySelectorAll('.katex')).toHaveLength(3);
    expect(container.querySelectorAll('.katex-display')).toHaveLength(2);
  });

  it('限制不受信任资源和异常大的 KaTeX 尺寸', () => {
    const { container } = render(
      <MarkdownRenderer
        content={
          '$$\\includegraphics{https://example.test/formula.png}$$\n\n$$\\rule{1000em}{1000em}$$'
        }
      />,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[style*="1000em"]')).toBeNull();
  });

  it('显式定界符中的任意 KaTeX 语法直接渲染，无效公式不影响后续正文', () => {
    const { container, getByText } = render(
      <MarkdownRenderer
        content={
          '$$\n\\xrightarrow[below]{above} y\n$$\n\n$$\n\\unknowncommand{x}\n$$\n\n后续正文仍可见'
        }
      />,
    );

    expect(container.querySelector('.katex-display')).not.toBeNull();
    expect(getByText('后续正文仍可见')).not.toBeNull();
  });

  it('正确渲染真实会话中的公式列表和递推公式', () => {
    const content = [
      '设 \\( A(n,k) \\) 表示从 \\( n \\) 个不同元素中选择 \\( k \\) 个，且条件集 \\( C_i \\) 之间存在递归依赖关系：',
      '- \\( C_i \\) 依赖于 \\( C_{i-1}, C_{i+1}, \\ldots, C_{i+r-1} \\)（\\( i \\) 从 1 到 \\( k \\)）；',
      '- 条件集 \\( C_i \\) 又依赖于前一个条件集 \\( C_{i-1}, C_i, \\ldots, C_{i+r-2} \\)。',
      '',
      '\\[',
      'A(n,k) = \\sum_{\\substack{i_1, i_2, \\ldots, i_r = 1 \\\\ i_1 + i_2 + \\cdots + i_r = k}}^{n} \\left( \\prod_{j=1}^{r} C_i(A(n-i_1), i_1) \\right),',
      '\\]',
      '',
      '其中 \\( C_i \\) 是条件集的组合数。',
    ].join('\n');
    const { container } = render(<MarkdownRenderer content={content} />);

    expect(container.querySelectorAll('.katex-error')).toHaveLength(0);
    expect(container.querySelectorAll('.katex-display')).toHaveLength(1);
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.textContent).not.toContain('$$');
  });

  it('渲染列表中方括号包裹的公式并保留周围 Markdown', () => {
    const content =
      '1. **Recursive Exponential Integrals:** [ G(x) = \\sum_{k=1}^{\\infty} \\frac{1}{k^2} ] *Complexity:* Nested integrals.';
    const { container, getByText } = render(<MarkdownRenderer content={content} />);

    expect(container.querySelectorAll('li')).toHaveLength(1);
    expect(container.querySelectorAll('.katex')).toHaveLength(1);
    expect(getByText('Recursive Exponential Integrals:').tagName).toBe('STRONG');
    expect(getByText('Complexity:').tagName).toBe('EM');
  });

  it('Markdown 强调标题保持加粗而不是被渲染成 KaTeX', () => {
    const { container, getByText } = render(
      <MarkdownRenderer content="**Explanation of its complexity:**" />,
    );

    expect(container.querySelectorAll('.katex')).toHaveLength(0);
    expect(getByText('Explanation of its complexity:').tagName).toBe('STRONG');
  });

  it('把模型用反引号包裹的明确数学表达式渲染为 KaTeX', () => {
    const content = [
      '1. **Nested Recursion:** The term `((1/2^k)^(k^2))` creates a nested exponential.',
      '2. **Nested Integrals:** The integral `∫₀¹ (log^m(x)) / e^x dx` depends on `k`.',
    ].join('\n');
    const { container } = render(<MarkdownRenderer content={content} />);

    expect(container.querySelectorAll('.katex')).toHaveLength(2);
    expect(container.querySelectorAll('code')).toHaveLength(1);
    expect(container.querySelector('code')?.textContent).toBe('k');
  });

  it('把命中来源的 Markdown 链接渲染为同号数字角标，并可悬浮预览、跳转原文', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <MarkdownRenderer
          content="MiniCPM 最新信息可查看 [官方说明](https://www.openbmb.cn/news)。"
          citations={[
            { url: 'https://example.com/other', title: '另一个来源' },
            {
              url: 'https://www.openbmb.cn/news',
              title: 'MiniCPM 官方说明',
              snippet: '这里是来源摘要，用于在不离开回答时快速判断来源是否相关。',
            },
          ]}
        />
      </TooltipProvider>,
    );

    // 角标数字 = 来源在 citations 中的下标 + 1，与底部参考资料、来源面板同号
    const badge = screen.getByRole('link', { name: '第 2 个来源' });
    expect(badge).toHaveTextContent('2');
    expect(badge).toHaveAttribute('href', 'https://www.openbmb.cn/news');
    expect(badge).toHaveAttribute('target', '_blank');
    // 打上标记位，正文链接的下划线/主色基础样式才会跳过角标
    expect(badge).toHaveAttribute('data-citation-badge');

    await user.hover(badge);

    expect(
      await screen.findAllByText('这里是来源摘要，用于在不离开回答时快速判断来源是否相关。'),
    ).not.toHaveLength(0);
  });

  it('模型输出的裸角标也统一渲染为数字角标', () => {
    render(
      <TooltipProvider>
        <MarkdownRenderer
          content="结论如此[1]。"
          citations={[{ url: 'https://www.openbmb.cn/news', title: 'MiniCPM 官方说明' }]}
        />
      </TooltipProvider>,
    );

    const badge = screen.getByRole('link', { name: '第 1 个来源' });
    expect(badge).toHaveTextContent('1');
    expect(badge).toHaveAttribute('href', 'https://www.openbmb.cn/news');
  });

  it('角标数字取后端下发的 ref，不取数组下标', () => {
    render(
      <TooltipProvider>
        <MarkdownRenderer
          content="结论如此[ref_5]。"
          citations={[{ ref: 5, url: 'https://www.openbmb.cn/news', title: 'MiniCPM 官方说明' }]}
        />
      </TooltipProvider>,
    );

    // 数组下标 +1 会是 1；后端编号是 5，多轮搜索下只有后者指得对。
    const badge = screen.getByRole('link', { name: '第 5 个来源' });
    expect(badge).toHaveTextContent('5');
    expect(badge).toHaveAttribute('href', 'https://www.openbmb.cn/news');
    expect(screen.queryByRole('link', { name: '第 1 个来源' })).toBeNull();
  });

  it('独占一行的来源链接保留标题，不压成裸角标', () => {
    render(
      <TooltipProvider>
        <MarkdownRenderer
          content={
            '公式如下。\n\n> [百度百科 - 一元三次方程求根公式](https://baike.baidu.com/item/x)'
          }
          citations={[{ url: 'https://baike.baidu.com/item/x', title: '一元三次方程求根公式' }]}
        />
      </TooltipProvider>,
    );

    // 角标仍在（与来源面板同号），但标题不能被吞掉——否则整行只剩一个灰色数字
    expect(screen.getByRole('link', { name: '第 1 个来源' })).toHaveTextContent('1');
    const title = screen.getByRole('link', { name: '百度百科 - 一元三次方程求根公式' });
    expect(title).toHaveAttribute('href', 'https://baike.baidu.com/item/x');
    expect(title).toHaveAttribute('target', '_blank');
    // 标记位让正文链接的主色下划线样式跳过来源行，行内配色仍跟随引用块
    expect(title).toHaveAttribute('data-citation-source');
  });

  it('行内的来源链接仍压成角标，不显示标题', () => {
    render(
      <TooltipProvider>
        <MarkdownRenderer
          content="结论如此 [官方说明](https://www.openbmb.cn/news)，可供参考。"
          citations={[{ url: 'https://www.openbmb.cn/news', title: 'MiniCPM 官方说明' }]}
        />
      </TooltipProvider>,
    );

    expect(screen.getByRole('link', { name: '第 1 个来源' })).toHaveTextContent('1');
    expect(screen.queryByText('官方说明')).toBeNull();
  });

  it('点击角标把命中的来源与同号序号回传给 onCitationActivate', async () => {
    const user = userEvent.setup();
    const onCitationActivate = vi.fn();
    const citations = [
      { url: 'https://example.com/other', title: '另一个来源' },
      { url: 'https://www.openbmb.cn/news', title: 'MiniCPM 官方说明' },
    ];
    render(
      <TooltipProvider>
        <MarkdownRenderer
          content="结论如此[2]。"
          citations={citations}
          onCitationActivate={onCitationActivate}
        />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole('link', { name: '第 2 个来源' }));

    // 回传的是从 1 起的展示序号，与角标数字、来源面板同号
    expect(onCitationActivate).toHaveBeenCalledWith(citations[1], 2);
  });

  it('思考态把 pre-wrap 限制在段落内部，段落之间不额外撑出空行', () => {
    const { container } = render(
      <MarkdownRenderer content={'第一段。\n\n第二段。'} variant="reasoning" />,
    );

    const root = container.firstElementChild as HTMLElement;
    const classes = root.className.split(/\s+/);

    /*
      react-markdown 会在相邻块级元素之间输出一个换行文本节点。容器级 pre-wrap 会把它当成
      硬换行，于是每个段落间凭空多出一整行高的空白；pre-wrap 必须只作用在段落内部，
      那里才是模型单换行分行需要保留的地方。
    */
    expect(classes).not.toContain('whitespace-pre-wrap');
    expect(classes).toContain('[&_p]:whitespace-pre-wrap');
    expect(container.querySelectorAll('p')).toHaveLength(2);
  });
});
