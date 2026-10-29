import { describe, expect, it } from 'vitest';

import { linkifyCitationMarkers } from '../citationMarkers';
import type { Citation } from '../../types';

/** 两条来源：下标 +1 即角标编号。 */
const citations: Citation[] = [
  { url: 'https://one.example.com/a', title: '来源一' },
  { url: 'https://two.example.com/b', title: '来源二' },
];

describe('linkifyCitationMarkers', () => {
  it('把裸角标改写为指向对应来源的 Markdown 链接', () => {
    expect(linkifyCitationMarkers('结论如此[1]。', citations)).toBe(
      '结论如此[1](https://one.example.com/a)。',
    );
  });

  it('连续角标逐个改写，编号与来源顺序一致', () => {
    expect(linkifyCitationMarkers('两处都提到[1][2]。', citations)).toBe(
      '两处都提到[1](https://one.example.com/a)[2](https://two.example.com/b)。',
    );
  });

  it('围栏代码块与行内代码内的角标保持原样', () => {
    const markdown = ['行内 `arr[1]` 不动。', '', '```js', 'const x = list[1];', '```'].join('\n');

    expect(linkifyCitationMarkers(markdown, citations)).toBe(markdown);
  });

  it('流式期间围栏未闭合时，剩余全文都按代码处理', () => {
    const markdown = ['正文[1]。', '', '```js', 'const x = list[2];'].join('\n');

    expect(linkifyCitationMarkers(markdown, citations)).toBe(
      ['正文[1](https://one.example.com/a)。', '', '```js', 'const x = list[2];'].join('\n'),
    );
  });

  it('编号越界时不改写（来源还没到达或模型编错号）', () => {
    expect(linkifyCitationMarkers('参考[3]。', citations)).toBe('参考[3]。');
    expect(linkifyCitationMarkers('参考[0]。', citations)).toBe('参考[0]。');
  });

  it('流式期间半截的 `[1` 不匹配', () => {
    expect(linkifyCitationMarkers('正在生成[1', citations)).toBe('正在生成[1');
  });

  it('图片语法与下标取值不当作角标', () => {
    expect(linkifyCitationMarkers('图片 ![1](https://img.example.com/x.png)', citations)).toBe(
      '图片 ![1](https://img.example.com/x.png)',
    );
    expect(linkifyCitationMarkers('取值 arr[1] 与 list[2]', citations)).toBe(
      '取值 arr[1] 与 list[2]',
    );
  });

  it('已是链接或链接引用定义时不再包一层', () => {
    expect(linkifyCitationMarkers('已有链接[1](https://other.example.com)', citations)).toBe(
      '已有链接[1](https://other.example.com)',
    );
    expect(linkifyCitationMarkers('[1]: https://other.example.com', citations)).toBe(
      '[1]: https://other.example.com',
    );
  });

  it('含括号的地址用尖括号包裹，避免 Markdown 在首个右括号处截断', () => {
    expect(
      linkifyCitationMarkers('见词条[1]。', [{ url: 'https://w.example.com/A_(b)', title: 'A' }]),
    ).toBe('见词条[1](<https://w.example.com/A_(b)>)。');
  });

  it('非 HTTP(S) 地址不改写', () => {
    expect(linkifyCitationMarkers('危险[1]。', [{ url: 'javascript:alert(1)', title: 'x' }])).toBe(
      '危险[1]。',
    );
  });

  it('提示词要求的 [ref_N] 角标按后端编号查来源', () => {
    const withRefs: Citation[] = [
      { ref: 4, url: 'https://one.example.com/a', title: '来源一' },
      { ref: 7, url: 'https://two.example.com/b', title: '来源二' },
    ];
    expect(linkifyCitationMarkers('结论[ref_7]。', withRefs)).toBe(
      '结论[7](https://two.example.com/b)。',
    );
    // 裸角标是兜底路径：模型不听话时同样按编号查，而不是按数组下标。
    expect(linkifyCitationMarkers('结论[4]。', withRefs)).toBe(
      '结论[4](https://one.example.com/a)。',
    );
  });

  it('后端已发号时编号以 ref 为准，不回退数组下标', () => {
    const withRefs: Citation[] = [
      { ref: 4, url: 'https://one.example.com/a', title: '来源一' },
      { ref: 7, url: 'https://two.example.com/b', title: '来源二' },
    ];
    // [1] 在旧口径下会指向数组第一条；有 ref 之后它是个无效编号，必须原样留着——
    // 回退数组下标恰好会把无效角标指到一条无关来源上，那正是本次改动要消灭的缺陷。
    expect(linkifyCitationMarkers('结论[1]。', withRefs)).toBe('结论[1]。');
    expect(linkifyCitationMarkers('结论[ref_9]。', withRefs)).toBe('结论[ref_9]。');
  });

  it('三位数编号也能识别', () => {
    expect(
      linkifyCitationMarkers('结论[ref_123]。', [
        { ref: 123, url: 'https://one.example.com/a', title: '来源一' },
      ]),
    ).toBe('结论[123](https://one.example.com/a)。');
  });

  it('英文正文里紧跟单词的 [ref_N] 仍是引用', () => {
    // 提示词要求角标紧跟论断，英文下必然写成 blue[ref_1]。下标判据若对带 ref_ 的角标
    // 也一刀切，英文回答的角标会被整批当成 arr[1] 吞掉。
    const withRefs: Citation[] = [{ ref: 1, url: 'https://a.example', title: 'A' }];
    expect(linkifyCitationMarkers('The sky is blue[ref_1].', withRefs)).toBe(
      'The sky is blue[1](https://a.example).',
    );
    // 裸角标没有前缀消歧，紧跟标识符时仍按下标取值处理。
    expect(linkifyCitationMarkers('arr[1] 取值', withRefs)).toBe('arr[1] 取值');
  });

  it('连续的 [ref_N] 角标整串判定为引用', () => {
    const withRefs: Citation[] = [
      { ref: 1, url: 'https://one.example.com/a', title: '来源一' },
      { ref: 2, url: 'https://two.example.com/b', title: '来源二' },
    ];
    expect(linkifyCitationMarkers('两处都提到[ref_1][ref_2]。', withRefs)).toBe(
      '两处都提到[1](https://one.example.com/a)[2](https://two.example.com/b)。',
    );
  });

  it('一个方括号里合写的多个编号全部展开', () => {
    // 提示词只要求角标紧跟论断，没规定一处只能引一条来源，模型把多来源合写是常态。
    const withRefs: Citation[] = [
      { ref: 3, url: 'https://one.example.com/a', title: '来源一' },
      { ref: 5, url: 'https://two.example.com/b', title: '来源二' },
    ];
    expect(linkifyCitationMarkers('打造模型库[ref_3, ref_5]。', withRefs)).toBe(
      '打造模型库[3](https://one.example.com/a)[5](https://two.example.com/b)。',
    );
    // 裸角标合写同理，中文顿号也是模型常用的分隔符。
    expect(linkifyCitationMarkers('打造模型库[3、5]。', withRefs)).toBe(
      '打造模型库[3](https://one.example.com/a)[5](https://two.example.com/b)。',
    );
  });

  it('合写角标里有编号查不到来源时整体保持原文', () => {
    // 半改写会留下「一个链接 + 一截裸文本」，读者无从判断后半截是没搜到还是渲染坏了。
    const withRefs: Citation[] = [{ ref: 3, url: 'https://one.example.com/a', title: '来源一' }];
    expect(linkifyCitationMarkers('打造模型库[ref_3, ref_9]。', withRefs)).toBe(
      '打造模型库[ref_3, ref_9]。',
    );
  });

  it('围栏代码块里的 [ref_N] 保持原样', () => {
    const markdown = ['```js', 'const x = map["ref_1"];', '// [ref_1]', '```'].join('\n');
    expect(linkifyCitationMarkers(markdown, [{ ref: 1, url: 'https://one.example.com/a' }])).toBe(
      markdown,
    );
  });

  it('无来源或正文没有方括号时原样返回', () => {
    expect(linkifyCitationMarkers('结论如此[1]。', [])).toBe('结论如此[1]。');
    expect(linkifyCitationMarkers('纯文本结论。', citations)).toBe('纯文本结论。');
    expect(linkifyCitationMarkers('', citations)).toBe('');
  });
});
