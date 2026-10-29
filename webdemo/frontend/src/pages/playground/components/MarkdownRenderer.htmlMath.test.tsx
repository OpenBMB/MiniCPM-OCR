import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MarkdownRenderer } from './MarkdownRenderer';

describe('OCR HTML 表格内公式', () => {
  it('HTML 表格处理不拆开普通 Markdown 公式里的 HTML 字面正文', () => {
    const latex = String.raw`\verb|<br>\(x\)|`;
    const { container } = render(<MarkdownRenderer variant="document" content={`$${latex}$`} />);
    expect(container.querySelectorAll('.katex')).toHaveLength(1);
    expect(container.querySelectorAll('.katex-error')).toHaveLength(0);
    expect(container.querySelector('annotation')).toHaveTextContent(latex);
    expect(container.querySelector('br')).toBeNull();
  });

  it('合并单元格内的公式、下标和科学计数法进入 KaTeX，保留表格定位', () => {
    const content = String.raw`<table><tr><th rowspan="2">名称</th><th colspan="2">单位 $N_A$</th></tr><tr><th>SI</th><th>厘米克秒</th></tr><tr><td>中子的康普顿波长</td><td>$\lambda_c=h/(m_a c)$</td><td>$10^{-13}\mathrm{cm}$</td></tr><tr><td>波尔兹曼常数</td><td>$10^{-23}\cdot K^{-1}$</td><td>$R=N_A k$</td></tr></table>`;
    const range = { start: 0, end: content.length };
    const { container } = render(
      <MarkdownRenderer
        variant="document"
        content={content}
        editableBlocks
        highlightRange={range}
        linkedRanges={[{ id: 'constants', range }]}
      />,
    );
    expect(container.querySelectorAll('.katex')).toHaveLength(5);
    expect(container.querySelectorAll('.katex-error')).toHaveLength(0);
    expect(container.querySelector('th[rowspan="2"]')).not.toBeNull();
    expect(container.querySelector('th[colspan="2"]')).not.toBeNull();
    expect(container.querySelector('[data-document-table]')).toHaveAttribute(
      'data-ocr-block-id',
      'constants',
    );
    expect(container.querySelector('[data-document-table]')).toHaveAttribute(
      'data-ocr-highlight',
      'true',
    );
    expect(container.textContent).not.toContain('$');
  });

  it.each([
    ['$a^2$', false],
    ['\\(a^2\\)', false],
    ['$$a^2$$', true],
    ['\\[a^2\\]', true],
    ['$$\na^2\n$$', true],
    ['\\[\na^2\n\\]', true],
  ])('单元格内兼容显式定界符 %s', (formula, display) => {
    const { container } = render(
      <MarkdownRenderer
        variant="document"
        content={`<table><tr><td>${formula}</td></tr></table>`}
      />,
    );
    expect(container.querySelectorAll('.katex')).toHaveLength(1);
    expect(container.querySelectorAll('.katex-display')).toHaveLength(display ? 1 : 0);
    expect(container.querySelector('annotation')).toHaveTextContent('a^2');
  });

  it.each([
    String.raw`\frac{1+\frac{a}{b}}{\sqrt[3]{1+x^2}}`,
    String.raw`\lim_{x\to0}\frac{\sin x}{x}=\sum_{n=0}^{\infty}\frac{(-1)^n x^{2n}}{(2n+1)!}`,
    String.raw`\int_0^{\infty}e^{-x^2}\,dx=\frac{\sqrt{\pi}}{2}`,
    String.raw`\left[\begin{matrix}a&b\\c&d\end{matrix}\right]`,
    String.raw`f(x)=\begin{cases}x^2&x>0\\0&x\le0\end{cases}`,
    String.raw`\begin{aligned}A&=\begin{pmatrix}a&b\\c&d\end{pmatrix}\\\det A&=ad-bc\end{aligned}`,
    String.raw`\underbrace{a+b+c}_{3\text{ 项}}=\overline{x}\pm\hat{\alpha}`,
    String.raw`E=mc^2\tag{1}`,
  ])('复杂公式 %s 的四种定界符保留正文与显示模式', (latex) => {
    const escaped = latex.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const formulas = [`$${escaped}$`, `\\(${escaped}\\)`, `$$${escaped}$$`, `\\[${escaped}\\]`];
    const { container } = render(
      <MarkdownRenderer
        variant="document"
        content={`<table><tr>${formulas.map((formula) => `<td>${formula}</td>`).join('')}</tr></table>`}
      />,
    );
    // tag 仅适用于 displayMode；行内模式仍保留源码和安全回退。
    const expectedErrors = latex.includes('\\tag') ? 2 : 0;
    expect(container.querySelectorAll('.katex')).toHaveLength(4 - expectedErrors);
    expect(container.querySelectorAll('.katex-error')).toHaveLength(expectedErrors);
    expect(container.querySelectorAll('.katex-display')).toHaveLength(2);
    expect([...container.querySelectorAll('annotation')].map((node) => node.textContent)).toEqual(
      Array.from({ length: 4 - expectedErrors }, () => latex),
    );
  });

  it('只解析单元格的公式，不修改代码、裸 LaTeX、未闭合定界符或属性', () => {
    const content = String.raw`<p>$outside$</p><table><tr><td title="$attribute$"><strong>$N_A$</strong><br><code>$x^2$</code><pre>$y^2$</pre>裸公式 \frac{a}{b}；金额 $100；&lt;img src=x onerror=alert(1)&gt;</td></tr></table>`;
    const { container } = render(<MarkdownRenderer variant="document" content={content} />);
    expect(container.querySelectorAll('.katex')).toHaveLength(1);
    expect(container.querySelector('td')).toHaveAttribute('title', '$attribute$');
    expect(container.querySelector('td code')).toHaveTextContent('$x^2$');
    expect(container.querySelector('td pre')).toHaveTextContent('$y^2$');
    expect(container.querySelector('p')).toHaveTextContent('$outside$');
    expect(container.querySelector('td')).toHaveTextContent(String.raw`\frac{a}{b}`);
    expect(container.querySelector('td')).toHaveTextContent('$100');
    expect(container.querySelector('img, [onerror]')).toBeNull();
    expect(container.querySelector('td br')).not.toBeNull();
  });

  it('多个与嵌套表格的公式只解析一次，不重复处理已有公式节点', () => {
    const content = String.raw`<table><tr><td>$a$<table><tr><td>$b$</td></tr></table><code class="math-inline">c^2</code></td></tr></table><table><tr><td>$d$</td></tr></table>`;
    const { container } = render(<MarkdownRenderer variant="document" content={content} />);
    expect(container.querySelectorAll('.katex')).toHaveLength(4);
    expect(container.querySelectorAll('annotation')).toHaveLength(4);
    expect(container.querySelectorAll('table')).toHaveLength(3);
  });

  it('转义美元符保持文本，公式内转义换行和 HTML 实体仍按数学文本解析', () => {
    const content = String.raw`<table><tr><td>\$literal\$</td><td>$x_{&lt;br&gt;}$</td><td>$x&lt;y$</td></tr></table>`;
    const { container } = render(<MarkdownRenderer variant="document" content={content} />);
    expect(container.querySelectorAll('.katex')).toHaveLength(2);
    expect([...container.querySelectorAll('annotation')].map((node) => node.textContent)).toEqual([
      'x_{<br>}',
      'x<y',
    ]);
    expect(container.querySelector('td')).toHaveTextContent(String.raw`\$literal\$`);
    expect(container.querySelector('td br')).toBeNull();
  });

  it('单元格文本换行不截断公式，未闭合公式不跨单元格寻找结束标记', () => {
    const content =
      '<table><tr><td>$10^{-23}\\cdot\nK^{-1}$</td><td>未闭合 $x^2</td><td>$N_A$</td></tr></table>';
    const { container } = render(<MarkdownRenderer variant="document" content={content} />);
    expect(container.querySelectorAll('.katex')).toHaveLength(2);
    expect(container.querySelector('td:nth-child(2)')).toHaveTextContent('未闭合 $x^2');
    expect(container.querySelector('td:last-child annotation')).toHaveTextContent('N_A');
    expect(container.querySelectorAll('.katex-error')).toHaveLength(0);
  });

  it.each(['$$x^2', '$$\nx^2', '$$$\nx^2\n$$'])('未闭合块级公式 %s 保留全部原文', (formula) => {
    const { container } = render(
      <MarkdownRenderer
        variant="document"
        content={`<table><tr><td>${formula}</td><td>$N_A$</td></tr></table>`}
      />,
    );
    expect(container.querySelector('td')?.textContent).toBe(formula);
    expect(container.querySelectorAll('.katex')).toHaveLength(1);
  });

  it('GFM 单元格已解析的转义美元符不被当作 HTML 公式二次解析', () => {
    const content = '| 内容 |\n| --- |\n| \\$literal\\$ 与 $N_A$ |';
    const { container } = render(<MarkdownRenderer variant="document" content={content} />);
    expect(container.querySelectorAll('.katex')).toHaveLength(1);
    expect(container.querySelector('td')).toHaveTextContent('$literal$');
    expect(container.querySelector('annotation')).toHaveTextContent('N_A');
  });

  it.each(['$N_A$', '\\(N_A\\)', '\\[\nN_A\n\\]'])(
    'HTML 文本缩进不妨碍定界符 %s 渲染',
    (formula) => {
      const content = `<table><tr><td>\n    ${formula}\n</td></tr></table>`;
      const { container } = render(<MarkdownRenderer variant="document" content={content} />);
      expect(container.querySelectorAll('.katex')).toHaveLength(1);
      expect(container.querySelector('annotation')).toHaveTextContent('N_A');
    },
  );

  it.each([
    [String.raw`\(x_{&lt;br&gt;}\)`, 'x_{<br>}'],
    [String.raw`\(\verb|\[x\]|\)`, String.raw`\verb|\[x\]|`],
    [String.raw`\(\verb|\(x\)|\)`, String.raw`\verb|\(x\)|`],
    [String.raw`\(\text{cost \$5}\)`, String.raw`\text{cost \$5}`],
    [String.raw`\(\verb|$a$|\)`, String.raw`\verb|$a$|`],
  ])('原生公式 %s 的正文不被二次转换', (formula, latex) => {
    const { container } = render(
      <MarkdownRenderer
        variant="document"
        content={`<table><tr><td>${formula}</td><td>\n    ${formula}\n</td></tr></table>`}
      />,
    );
    expect(container.querySelectorAll('.katex')).toHaveLength(2);
    expect([...container.querySelectorAll('annotation')].map((node) => node.textContent)).toEqual([
      latex,
      latex,
    ]);
    expect(container.querySelector('td br')).toBeNull();
  });

  it('非法公式回退不影响相邻单元格，危险 HTML 与 KaTeX 命令仍受限', () => {
    const content = String.raw`<table onclick="alert(1)"><tr><td>$\frac{a}{$</td><td>$b^2$</td><td>$\href{javascript:alert(1)}{x}$</td><td>$\includegraphics{https://example.test/a.png}$</td><td><script>alert(1)</script>后续正文</td></tr></table>`;
    const { container } = render(<MarkdownRenderer variant="document" content={content} />);
    expect(container.querySelector('.katex-error')).not.toBeNull();
    expect(container.querySelector('annotation')).toHaveTextContent('b^2');
    expect(container.querySelector('script, [onclick], img, a[href^="javascript:"]')).toBeNull();
    expect(container).toHaveTextContent('后续正文');
  });
});

describe('OCR 混写公式定界符', () => {
  it('行尾多余的 $ 不阻断后续 $$ 块级公式渲染', () => {
    const content = String.raw`\mathcal{J}(\theta)=$ $$
\mathbb{E}_{X\sim\mathbb{P}_{\text{ref}}}
$$

$$
= \mathbb{E}_{t\sim\mathcal{U}[0,1]}
$$`;
    const { container } = render(<MarkdownRenderer variant="document" content={content} />);
    expect(container.querySelectorAll('.katex')).toHaveLength(2);
    expect(container.querySelectorAll('.katex-display')).toHaveLength(2);
    expect(container.querySelectorAll('.katex-error')).toHaveLength(0);
    expect([...container.querySelectorAll('annotation')].map((node) => node.textContent)).toEqual([
      String.raw`\mathcal{J}(\theta)=
\mathbb{E}_{X\sim\mathbb{P}_{\text{ref}}}`,
      String.raw`= \mathbb{E}_{t\sim\mathcal{U}[0,1]}`,
    ]);
    expect(container.textContent).not.toContain('$');
  });
});
