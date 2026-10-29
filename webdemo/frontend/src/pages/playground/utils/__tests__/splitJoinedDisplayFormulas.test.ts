import { describe, expect, it } from 'vitest';

import { normalizeMathDelimiters } from '../math';
import { splitJoinedDisplayFormulas, unwrapSizedDelimiters } from '../math-markdown';

const first = String.raw`\mathbb{E}[A]`;
const second = String.raw`=0+(1-P)`;
const third = String.raw`\Rightarrow\mathbb{E}[J]\propto\Phi`;

describe('拆开粘连的显示公式', () => {
  it('把同一块里的多段 $$ 拆成各自独立的显示公式', () => {
    const source = `$$\n${first}$$ $$${second}$$ $$${third}\n$$`;
    expect(splitJoinedDisplayFormulas(source)).toBe(
      [`$$\n${first}\n$$`, `$$\n${second}\n$$`, `$$\n${third}\n$$`].join('\n\n'),
    );
  });

  it('渲染和编辑共用的入口都会拆开', () => {
    const source = `前文\n\n$$\n${first}$$ $$${second}$$`;
    const split = ['前文', `$$\n${first}\n$$`, `$$\n${second}\n$$`].join('\n\n');
    expect(normalizeMathDelimiters(source, { detectBareMath: false })).toBe(split);
    expect(normalizeMathDelimiters(source)).toBe(split);
  });

  it('单个显示公式和行内公式保持原样', () => {
    const display = `$$\n${first}\n$$`;
    const inline = `正文 $${second}$ 结束`;
    expect(splitJoinedDisplayFormulas(`${display}\n\n${inline}`)).toBe(`${display}\n\n${inline}`);
  });

  it('代码块里的美元符不拆', () => {
    const source = `\`\`\`\n$$${first}$$ $$${second}$$\n\`\`\``;
    expect(splitJoinedDisplayFormulas(source)).toBe(source);
  });
});

describe('兼容 KaTeX 的尺寸定界符', () => {
  it('把 \\bigg{[} 收成 \\bigg[，预览和编辑入口一致', () => {
    const source = String.raw`$$\mathbb{E}\bigg{[}x\big{]}\bigg{]}$$`;
    const expected = String.raw`$$\mathbb{E}\bigg[x\big]\bigg]$$`;
    expect(unwrapSizedDelimiters(source)).toBe(expected);
    expect(normalizeMathDelimiters(source, { detectBareMath: false })).toBe(expected);
  });

  it('已经合法的定界符和代码块保持原样', () => {
    const display = String.raw`$$\left\{x\right\}$$`;
    const code = String.raw`行内 \`\bigg{[}\` 与` + '\n```\n\\bigg{[}\n```';
    expect(unwrapSizedDelimiters(display)).toBe(display);
    expect(unwrapSizedDelimiters(code)).toBe(code);
  });
});
