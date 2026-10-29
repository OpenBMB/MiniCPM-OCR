import { describe, expect, it } from 'vitest';

import { replaceNativeMathDelimiters } from '../math-native';

describe('原生公式外层定界符扫描', () => {
  it('按原文顺序转换多个公式并记录行内边界', () => {
    const ranges: [number, number][] = [];
    const source = String.raw`前\(a\)；\[b\]；\(c\)后`;
    expect(
      replaceNativeMathDelimiters(source, {
        onInline: (start, end) => ranges.push([start, end]),
      }),
    ).toBe('前$a$；\n$$\nb\n$$\n；$c$后');
    expect(ranges.map(([start, end]) => source.slice(start, end))).toEqual([
      String.raw`\(a\)`,
      String.raw`\(c\)`,
    ]);
  });

  it.each([String.raw`\verb|\[x\]|`, String.raw`\verb*+\(x\)+`])(
    '只转换外层标记，逐字正文 %s 保持不变',
    (latex) => {
      expect(replaceNativeMathDelimiters(`\\(${latex}\\)`)).toBe(`$${latex}$`);
    },
  );

  it('已有公式和代码范围保持原文，原生公式内部的保护范围不拆断公式', () => {
    const source = String.raw`$\(keep\)$ 与 \(x_{<br>}\)`;
    expect(
      replaceNativeMathDelimiters(source, {
        protectedRanges: [
          { start: 0, end: 10 },
          { start: source.indexOf('<br>'), end: source.indexOf('<br>') + 4 },
        ],
      }),
    ).toBe(String.raw`$\(keep\)$ 与 $x_{<br>}$`);
  });

  it('成对反斜杠不作为原生定界符，空公式和未闭合正文原样保留', () => {
    const source = String.raw`\\(literal\\)；\(\)；\(未闭合`;
    expect(replaceNativeMathDelimiters(source)).toBe(source);
    expect(replaceNativeMathDelimiters(String.raw`\(a\\)b\)`)).toBe(String.raw`$a\\)b$`);
    expect(replaceNativeMathDelimiters(String.raw`\(\verb|未闭合\)`)).toBe(
      String.raw`\(\verb|未闭合\)`,
    );
  });

  it('大量未闭合起始标记不反复回扫剩余文本', () => {
    const source = String.raw`\(`.repeat(100_000);
    const started = performance.now();
    expect(replaceNativeMathDelimiters(source)).toBe(source);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
