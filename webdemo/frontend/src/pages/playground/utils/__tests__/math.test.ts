/**
 * Unit tests for normalizeMathDelimiters: LaTeX delimiter conversion + code-region protection.
 */

import { describe, it, expect } from 'vitest';
import { normalizeDocumentMathDelimiters, normalizeMathDelimiters } from '../math';
import { splitDollarMath } from '../math-markdown';

describe('document math offset mapping', () => {
  it('已有美元符公式的 HTML 字面正文不拆开保护范围或改变偏移', () => {
    const source = String.raw`$\verb|<br>\(x\)|$`;
    const normalized = normalizeDocumentMathDelimiters(source);
    expect(normalized.content).toBe(source);
    expect(normalized.mapOffset(source.length)).toBe(source.length);
  });

  it('原始 HTML 保留定界符和正文，外部公式仍规范化并保持范围映射', () => {
    const html = String.raw`<table><tr><td>\(\text{cost \$5}\)</td><td title="\[attr\]"><code>\(code\)</code></td></tr></table>`;
    const source = `\\(before\\)\n\n${html}\n\n\\(after\\)`;
    const normalized = normalizeDocumentMathDelimiters(source);
    expect(normalized.content).toBe(`$before$\n\n${html}\n\n$after$`);
    const start = source.indexOf(html);
    expect(
      normalized.content.slice(
        normalized.mapOffset(start),
        normalized.mapOffset(start + html.length),
      ),
    ).toBe(html);
    expect(normalized.mapOffset(source.length)).toBe(source.length - 4);
  });

  it.each([String.raw`\verb|\[x\]|`, String.raw`\verb|\(x\)|`])(
    '原生公式正文 %s 保持原样且偏移映射只移除外层定界符',
    (latex) => {
      const source = `前\\(${latex}\\)后`;
      const normalized = normalizeDocumentMathDelimiters(source);
      expect(normalized.content).toBe(`前$${latex}$后`);
      expect(normalized.mapOffset(source.length)).toBe(source.length - 2);
    },
  );

  it('should map native delimiters once while preserving code and dollar math', () => {
    const fragments = [
      '普通文字',
      '\\(a+b\\)',
      '`\\(code\\)`',
      '$\\(protected\\)$',
      '\\[x + \\(y\\)\\]',
      '```\n\\(code\\)\n```',
      '结尾',
    ];
    const source = fragments.join('\n\n');
    const normalized = normalizeDocumentMathDelimiters(source);
    expect(normalized.content).toBe(normalizeMathDelimiters(source, { detectBareMath: false }));
    let cursor = 0;
    for (const fragment of fragments) {
      const start = source.indexOf(fragment, cursor);
      const end = start + fragment.length;
      expect(normalized.content.slice(normalized.mapOffset(start), normalized.mapOffset(end))).toBe(
        normalizeMathDelimiters(fragment, { detectBareMath: false }),
      );
      cursor = end;
    }
  });
});

describe('document math OCR 定界符修复', () => {
  const source = String.raw`\mathcal{J}(\theta)=$ $$
\mathbb{E}_{X\sim\mathbb{P}_{\text{ref}}}
$$

$$
= \mathbb{E}_{t\sim\mathcal{U}[0,1]}
$$`;

  it('把行尾 $ $$ 残片修复为完整块级公式并保持偏移单调', () => {
    const normalized = normalizeDocumentMathDelimiters(source);
    expect(normalized.content).toBe(String.raw`$$
\mathcal{J}(\theta)=
\mathbb{E}_{X\sim\mathbb{P}_{\text{ref}}}
$$

$$
= \mathbb{E}_{t\sim\mathcal{U}[0,1]}
$$`);
    const bodyStart = source.indexOf(String.raw`\mathbb{E}`);
    expect(normalized.mapOffset(bodyStart)).toBe(
      normalized.content.indexOf(String.raw`\mathbb{E}`),
    );
    expect(normalized.mapOffset(source.length)).toBe(normalized.content.length);
  });

  it('孤立的单美元符不借用后续 $$ 围栏的字符闭合', () => {
    expect(splitDollarMath('x=$ $$\na\n$$')).toEqual([
      { value: 'x=$ ', protected: false },
      { value: '$$\na\n$$', protected: true },
    ]);
  });

  it('代码块与非公式前缀不参与修复', () => {
    const code = '```\n\\mathcal{J}(\\theta)=$ $$\nx\n$$\n```';
    expect(normalizeDocumentMathDelimiters(code).content).toBe(code);

    const prose = '价格 $ $$\nx\n$$';
    expect(normalizeDocumentMathDelimiters(prose).content).toBe(prose);
  });
});

describe('normalizeMathDelimiters', () => {
  it('把独占一行的裸 LaTeX 方程转换为块级公式', () => {
    const formula = 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}';

    expect(normalizeMathDelimiters(`最终答案：\n\n${formula}`)).toBe(
      `最终答案：\n\n$$\n${formula}\n$$`,
    );
  });

  it('把完整的裸 LaTeX 环境转换为块级公式', () => {
    const formula = '\\begin{aligned}\nx &= a + b \\\\\ny &= c + d\n\\end{aligned}';

    expect(normalizeMathDelimiters(`计算如下：\n\n${formula}\n\n结束。`)).toBe(
      `计算如下：\n\n$$\n${formula}\n$$\n\n结束。`,
    );
  });

  it('把以 LaTeX 命令开头的独占行公式转换为块级公式', () => {
    const formula = '\\sum_{i=1}^{n} i';
    expect(normalizeMathDelimiters(formula)).toBe(`$$\n${formula}\n$$`);
  });

  it.each([
    '\\boxed{\\hat{x}}',
    '\\overset{?}{=}',
    '\\underbrace{a+b+c}_{3\\text{ terms}}',
    'a \\oplus b',
  ])('不依赖命令白名单识别 KaTeX 支持的裸公式：%s', (formula) => {
    expect(normalizeMathDelimiters(formula)).toBe(`$$\n${formula}\n$$`);
  });

  it.each(['E = mc^2', 'a_n = a_1 + (n-1)d', 'x^2 + y^2'])(
    '识别不含反斜杠命令的裸数学表达式：%s',
    (formula) => {
      expect(normalizeMathDelimiters(formula)).toBe(`$$\n${formula}\n$$`);
    },
  );

  it('识别带中文 text 内容的公式', () => {
    const formula =
      'f(x) = \\begin{cases}x, & \\text{当 } x > 0 \\\\ 0, & \\text{其他}\\end{cases}';
    expect(normalizeMathDelimiters(formula)).toBe(`$$\n${formula}\n$$`);
  });

  it('识别 KaTeX 支持的任意完整环境', () => {
    const formula = '\\begin{array}{cc}\na & b \\\\\nc & d\n\\end{array}';
    expect(normalizeMathDelimiters(formula)).toBe(`$$\n${formula}\n$$`);
  });

  it('识别嵌套的完整 KaTeX 环境', () => {
    const formula =
      '\\begin{aligned}\nA &= \\begin{pmatrix}a & b \\\\ c & d\\end{pmatrix} \\\\\ny &= 2\n\\end{aligned}';
    expect(normalizeMathDelimiters(formula)).toBe(`$$\n${formula}\n$$`);
  });

  it('保留 KaTeX 不支持的裸环境原文', () => {
    const formula = '\\begin{unknown}\na\n\\end{unknown}';
    expect(normalizeMathDelimiters(formula)).toBe(formula);
  });

  it('流式输出中尚未闭合的裸 LaTeX 保持原文', () => {
    const incompleteFormula = 'x = \\frac{a';
    expect(normalizeMathDelimiters(incompleteFormula)).toBe(incompleteFormula);
  });

  it('块级 \\[ \\] 转 $$ $$', () => {
    expect(normalizeMathDelimiters('前\\[x = a + b\\]后')).toBe('前\n$$\nx = a + b\n$$\n后');
  });

  it('行内 \\( \\) 转 $ $', () => {
    expect(normalizeMathDelimiters('形如 \\(a \\neq 0\\) 的')).toBe('形如 $a \\neq 0$ 的');
  });

  it('列表标记旁的行内公式不会被误补成块级公式', () => {
    expect(normalizeMathDelimiters('- \\( C_i \\) 依赖于 \\( C_{i-1} \\)')).toBe(
      '- $ C_i $ 依赖于 $ C_{i-1} $',
    );
  });

  it('把列表正文中方括号包裹的 LaTeX 转换为行内公式', () => {
    const formula =
      'G(x) = \\sum_{k=1}^{\\infty} \\frac{\\left(\\int_0^x e^{-t^2} dt\\right)^{k^2}}{\\left(\\sum_{j=1}^k j^2\\right)^{k^2}}';
    const content = `1. **Recursive Exponential Integrals:** [ ${formula} ] *Complexity:* Nested integrals.`;

    expect(normalizeMathDelimiters(content)).toBe(
      `1. **Recursive Exponential Integrals:** $ ${formula} $ *Complexity:* Nested integrals.`,
    );
  });

  it('Markdown 强调标题不会被误判为裸公式', () => {
    const content = '**Explanation of its complexity:**';
    expect(normalizeMathDelimiters(content)).toBe(content);
  });

  it('Markdown 链接、任务列表和引用编号不会被当成方括号公式', () => {
    const content = ['[数学文档](https://example.test/math)', '- [x] 已完成', '参考文献 [1]'].join(
      '\n',
    );
    expect(normalizeMathDelimiters(content)).toBe(content);
  });

  it('紧邻变量的星号仍可作为裸公式乘法符号', () => {
    expect(normalizeMathDelimiters('a*b*c')).toBe('$$\na*b*c\n$$');
  });

  it('已是美元符的公式保持不变', () => {
    const s = '$$ x = \\frac{1}{2} $$ 和 $a^2$';
    expect(normalizeMathDelimiters(s)).toBe(s);
  });

  it('围栏代码块内的 \\[ \\] 不被转换', () => {
    const s = '```\narr\\[0\\]\n```';
    expect(normalizeMathDelimiters(s)).toBe(s);
  });

  it('围栏代码块内的裸 LaTeX 环境不被转换', () => {
    const content = '```latex\n\\begin{aligned}\nx &= y\n\\end{aligned}\n```';
    expect(normalizeMathDelimiters(content)).toBe(content);
  });

  it.each(['````latex\nx = \\frac{a}{b}\n````', '~~~latex\nx = \\frac{a}{b}\n~~~'])(
    '任意合法 Markdown 围栏中的公式保持原文',
    (content) => {
      expect(normalizeMathDelimiters(content)).toBe(content);
    },
  );

  it('Markdown 缩进代码块中的公式保持原文', () => {
    const content = '示例：\n\n    x = \\frac{a}{b}\n    y = x^2';
    expect(normalizeMathDelimiters(content)).toBe(content);
  });

  it('行内代码内的定界符不被转换', () => {
    expect(normalizeMathDelimiters('用 `a\\(b\\)` 表示')).toBe('用 `a\\(b\\)` 表示');
  });

  it.each([
    ['`((1/2^k)^(k^2))`', '$((1/2^k)^(k^2))$'],
    ['`∫₀¹ (log^m(x)) / e^x dx`', '$∫₀¹ (log^m(x)) / e^x dx$'],
    ['`\\sum_{k=1}^n`', '$\\sum_{k=1}^n$'],
  ])('把具备明确数学结构的行内代码转换为行内公式：%s', (content, expected) => {
    expect(normalizeMathDelimiters(content)).toBe(expected);
  });

  it.each(['`npm run build`', '`foo_bar`', '`const x = 1`', '`/api/models`', '`k`'])(
    '普通行内代码保持原样：%s',
    (content) => {
      expect(normalizeMathDelimiters(content)).toBe(content);
    },
  );

  it('普通说明文字里的 LaTeX 命令不被误判为整行公式', () => {
    const content = '公式命令 \\frac{a}{b} 可用于表示分数。';
    expect(normalizeMathDelimiters(content)).toBe(content);
  });

  it('英文说明文字里的 LaTeX 命令不被误判为整行公式', () => {
    const content = '\\frac{a}{b} is a fraction.';
    expect(normalizeMathDelimiters(content)).toBe(content);
  });

  it('英文说明中的 LaTeX 环境只渲染环境本身', () => {
    const environment = '\\begin{pmatrix}a & b \\\\ c & d\\end{pmatrix}';
    expect(normalizeMathDelimiters(`Matrix is ${environment}.`)).toBe(
      `Matrix is \n$$\n${environment}\n$$\n.`,
    );
  });

  it('Markdown 表格中的裸 LaTeX 不被改写为块级公式', () => {
    const content = '| 名称 | 表达式 |\n| --- | --- |\n| 分数 | \\frac{a}{b} |';
    expect(normalizeMathDelimiters(content)).toBe(content);
  });

  it.each([
    'Price = 5 USD',
    '版本 version = latest',
    '访问 https://example.test/x?a=1',
    '价格是 \\$5，折扣为 20%。',
    'npm run build -- --mode=production',
    '/api/models/{model_id}',
    'C:\\workspace\\model_id',
    'status = active',
    'mode = production',
    '2026-08-13',
    '20:30:15',
    // A fragment of the model emitting a tool call as body text: it used to be misread as a formula by `=` / `>` / `_` and rendered as serif math.
    ' name="weather_search"> name="location">Beijing',
    'name="location"',
    "name='location'",
    'weather_search > location > Beijing',
  ])('普通文本不被误判为公式：%s', (content) => {
    expect(normalizeMathDelimiters(content)).toBe(content);
  });

  // The `-` / `*` / `=` in these lines used to be treated as operators, and KaTeX could parse them, so a thematic break was rendered as a string of serif minus signs.
  it.each(['---', '----', '***', '___', '- - -', '* * *', '===', '**', '+', '>'])(
    'Markdown 标记行保持原样：%s',
    (line) => {
      const content = `前文。\n\n${line}\n\n后文。`;
      expect(normalizeMathDelimiters(content)).toBe(content);
    },
  );

  it('setext 标题下划线不被拆成段落加公式', () => {
    const content = '一、复杂公式\n---\n\n正文。';
    expect(normalizeMathDelimiters(content)).toBe(content);
  });

  /*
    Web-search citation markers used to be rendered as formulas as a class: `_` hits the subscript feature, `ref` is only three letters and passes
    the "identifiers are all short" check, and KaTeX can parse ref_1, so wrapBracketedMath eats the brackets
    as formula delimiters — the marker disappears from the body and only a run of italic subscripts remains.
  */
  it.each(['[ref_1]', '[ref_12]', '[ref_3, ref_5]', '[ref_3，ref_5]', '[ref_1; ref_2]'])(
    '联网搜索引用角标不被当成公式：%s',
    (marker) => {
      const content = `面壁智能是一家人工智能企业${marker}`;
      expect(normalizeMathDelimiters(content)).toBe(content);
    },
  );

  it('引用角标护栏不误伤真实的方括号公式', () => {
    expect(normalizeMathDelimiters('设 [x_1 = 2] 成立')).toBe('设 $x_1 = 2$ 成立');
  });

  it('空串安全', () => {
    expect(normalizeMathDelimiters('')).toBe('');
  });
});
