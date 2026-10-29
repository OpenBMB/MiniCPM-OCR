/**
 * Unit tests for Markdown table extraction: only well-formed GFM tables count; prefer a miss over mistaking formulas and code for tables.
 */

import { describe, expect, it } from 'vitest';
import { extractMarkdownTables, markdownTablesToHtml, markdownTablesToTsv } from '../markdownTable';

describe('extractMarkdownTables', () => {
  it('reads a table and drops the delimiter row', () => {
    const tables = extractMarkdownTables('| 项目 | 金额 |\n| --- | ---: |\n| 差旅 | 1,200 |');
    expect(tables).toEqual([
      [
        ['项目', '金额'],
        ['差旅', '1,200'],
      ],
    ]);
  });

  it('reads several tables separated by prose', () => {
    const markdown = [
      '| A |',
      '| - |',
      '| 1 |',
      '',
      '中间一段说明文字',
      '',
      '| B |',
      '| - |',
      '| 2 |',
    ].join('\n');
    expect(extractMarkdownTables(markdown)).toHaveLength(2);
  });

  it('ignores pipe-bearing lines without a delimiter row', () => {
    // LaTeX absolute values and pipes inside code both contain `|`; treating them as a table would shatter the formula.
    expect(extractMarkdownTables('$$ \\| x \\|_2 $$\ncat a | grep b')).toEqual([]);
  });

  it('使用 GFM 解析转义竖线和加粗文字', () => {
    expect(extractMarkdownTables('| 名称 | 值 |\n| --- | --- |\n| A\\|B | **100** |')).toEqual([
      [
        ['名称', '值'],
        ['A|B', '100'],
      ],
    ]);
  });

  it('HTML 合并单元格保留列位置，并排除代码块中的表格', () => {
    const html =
      '<table><tr><th colspan="2">合并表头</th></tr>' +
      '<tr><td rowspan="2">A &amp; B</td><td>100</td></tr><tr><td>200</td></tr></table>';
    expect(extractMarkdownTables(`${html}\n\n\`\`\`html\n${html}\n\`\`\``)).toEqual([
      [
        ['合并表头', ''],
        ['A & B', '100'],
        ['', '200'],
      ],
    ]);
  });
});

describe('markdownTablesToTsv', () => {
  it('returns an empty string when there is no table', () => {
    expect(markdownTablesToTsv('# 标题\n正文')).toBe('');
  });

  it('joins cells with tabs so Chinese commas need no escaping', () => {
    expect(markdownTablesToTsv('| 项目 | 金额 |\n| --- | --- |\n| 差旅 | 1,200 |')).toBe(
      '项目\t金额\n差旅\t1,200',
    );
  });

  it('separates multiple tables with a blank line', () => {
    const markdown = '| A |\n| - |\n| 1 |\n\n| B |\n| - |\n| 2 |';
    expect(markdownTablesToTsv(markdown)).toBe('A\n1\n\nB\n2');
  });

  it('单元格换行用 TSV 引号包裹，不生成额外数据行', () => {
    expect(
      markdownTablesToTsv('<table><tr><td>第一行<br>第二行</td><td>100</td></tr></table>'),
    ).toBe('"第一行\n第二行"\t100');
  });

  it.each([
    '&lt;br&gt;',
    '&lt;br /&gt;',
    '&#60;BR&#62;',
    '&#x3c;br/&#x3e;',
    '&amp;lt;br&amp;gt;',
    '&amp;#60;BR&amp;#62;',
  ])('复制 HTML 与 GFM 表格时将 %s 恢复为单元格内换行', (lineBreak) => {
    const html = `<table><tr><td>第一行${lineBreak}第二行</td></tr></table>`;
    const gfm = `| 内容 |\n| --- |\n| 第一行${lineBreak}第二行 |`;
    expect(markdownTablesToTsv(html)).toBe('"第一行\n第二行"');
    expect(markdownTablesToTsv(gfm)).toBe('内容\n"第一行\n第二行"');
    expect(markdownTablesToHtml(html)).toBe(
      '<table><tbody><tr><td>第一行<br>第二行</td></tr></tbody></table>',
    );
    expect(markdownTablesToHtml(gfm)).toContain('<td>第一行<br>第二行</td>');
  });

  it('复制表格不将代码示例或其他转义 HTML 解释为标签', () => {
    const html =
      '<table><tr><td>甲&lt;br&gt;乙 <code>示例&lt;br&gt;</code> &lt;img src=x onerror=alert(1)&gt;</td></tr></table>';
    expect(extractMarkdownTables(html)).toEqual([
      [['甲\n乙 示例<br> <img src=x onerror=alert(1)>']],
    ]);
    expect(markdownTablesToHtml(html)).toContain(
      '甲<br>乙 示例&lt;br&gt; &lt;img src=x onerror=alert(1)&gt;',
    );
    expect(extractMarkdownTables('| 内容 |\n| --- |\n| `代码&lt;br&gt;` |')).toEqual([
      [['内容'], ['代码&lt;br&gt;']],
    ]);
  });
});

describe('markdownTablesToHtml', () => {
  it('returns an empty string when there is no table', () => {
    expect(markdownTablesToHtml('# 标题\n正文')).toBe('');
  });

  it('输出真正的表格结构，飞书与 Word 才能还原单元格', () => {
    expect(markdownTablesToHtml('| 项目 | 金额 |\n| --- | --- |\n| 差旅 | 1,200 |')).toBe(
      '<table><tbody><tr><td>项目</td><td>金额</td></tr>' +
        '<tr><td>差旅</td><td>1,200</td></tr></tbody></table>',
    );
  });

  it('转义 HTML 特殊字符，单元格换行转为 br', () => {
    expect(
      markdownTablesToHtml('<table><tr><td>a &amp; b</td><td>&lt;i&gt;</td></tr></table>'),
    ).toBe('<table><tbody><tr><td>a &amp; b</td><td>&lt;i&gt;</td></tr></tbody></table>');
    expect(markdownTablesToHtml('<table><tr><td>第一行<br>第二行</td></tr></table>')).toBe(
      '<table><tbody><tr><td>第一行<br>第二行</td></tr></tbody></table>',
    );
  });

  it('多张表之间留空段落，避免 Word 合并相邻表格', () => {
    const markdown = '| A |\n| - |\n| 1 |\n\n中间一段说明文字\n\n| B |\n| - |\n| 2 |';
    expect(markdownTablesToHtml(markdown)).toBe(
      '<table><tbody><tr><td>A</td></tr><tr><td>1</td></tr></tbody></table>' +
        '<p><br></p>' +
        '<table><tbody><tr><td>B</td></tr><tr><td>2</td></tr></tbody></table>',
    );
  });
});
