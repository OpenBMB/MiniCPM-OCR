import { describe, expect, it } from 'vitest';
import type { ImageParseSdkResult } from '@/api/map/imageParseSdk';

import type { ImageParseLayoutBlock } from '../imageParseSample';
import { mergeImageParseTables, mergeImageParseTablesInPage } from '../imageParseTableMerge';

const HEADER =
  '<tr><th rowspan="2">名称</th><th colspan="2">数值</th></tr><tr><th>本期</th><th>上期</th></tr>';

function block(
  kind: ImageParseLayoutBlock['kind'],
  text: string,
  y: number,
  h: number,
  markdownStart: number,
): ImageParseLayoutBlock {
  return {
    id: `${kind}-${markdownStart}`,
    kind,
    x: 0,
    y,
    w: 1,
    h,
    text,
    markdown: text,
    markdownStart,
    markdownEnd: markdownStart + text.length,
    confidence: 0.9,
  };
}

function page(
  table: string,
  row: string,
  atBottom = true,
  fullPage = false,
  header = '页眉',
  footer = '1',
): ImageParseSdkResult {
  const markdown = `${header}\n\n${table}\n\n${footer}`;
  const tableStart = markdown.indexOf(table);
  const footerStart = markdown.lastIndexOf(footer);
  return {
    markdown,
    requestId: `request-${row}`,
    blocks: [
      block('header', header, 0, 0.05, 0),
      block('table', table, atBottom ? 0.82 : 0.02, fullPage ? 0.9 : 0.16, tableStart),
      block('footer', footer, 0.98, 0.02, footerStart),
    ],
  };
}

function imageResult(tables: readonly string[], gap = 0.01): ImageParseSdkResult {
  const blocks: ImageParseLayoutBlock[] = [];
  const parts: string[] = [];
  let cursor = 0;
  tables.forEach((table, index) => {
    if (index) parts.push('\n\n');
    parts.push(table);
    const start = cursor + (index ? 2 : 0);
    const y = 0.1 + index * (0.2 + gap);
    blocks.push(block('table', table, y, 0.2, start));
    cursor = start + table.length;
  });
  return { markdown: parts.join(''), requestId: 'single-image', blocks };
}

describe('mergeImageParseTables', () => {
  it('把续页表格接回上一页，跳过重复表头并保留合并单元格', () => {
    const first = page(
      `<table>${HEADER}<tr><td>甲公司</td><td>10</td><td>9</td></tr></table>`,
      '1',
    );
    const second = page(
      `<table>${HEADER}<tr><td>乙公司</td><td>20</td><td>19</td></tr></table>`,
      '2',
      false,
    );

    const merged = mergeImageParseTables([
      { page: 1, result: first },
      { page: 2, result: second },
    ]);

    expect([...merged.keys()]).toEqual([0, 1]);
    expect(merged.get(0)!.markdown.match(/<tr>/g)).toHaveLength(4);
    expect(merged.get(0)!.markdown).toContain('乙公司');
    expect(merged.get(0)!.markdown).toContain('rowspan="2"');
    expect(merged.get(0)!.markdown).toContain('colspan="2"');
    expect(merged.get(0)!.blocks[1]).toMatchObject({ kind: 'table', ttsInvalid: true });
    expect(merged.get(1)!.markdown).not.toContain('<table');
    expect(merged.get(1)!.markdown).toContain('1');
    expect(merged.get(1)!.blocks[1]).toMatchObject({
      mergedIntoPreviousPage: true,
      markdown: '',
      ttsInvalid: true,
    });
  });

  it('连续三页的表格合并到第一页', () => {
    const pages = [
      page(`<table>${HEADER}<tr><td>甲</td><td>1</td><td>2</td></tr></table>`, '1'),
      page(`<table>${HEADER}<tr><td>乙</td><td>3</td><td>4</td></tr></table>`, '2', false, true),
      page(`<table>${HEADER}<tr><td>丙</td><td>5</td><td>6</td></tr></table>`, '3', false),
    ].map((result, index) => ({ page: index + 1, result }));

    const merged = mergeImageParseTables(pages);

    expect([...merged.keys()]).toEqual([0, 1, 2]);
    expect(merged.get(0)!.markdown.match(/<tr>/g)).toHaveLength(5);
    expect(merged.get(0)!.markdown).toContain('丙');
    expect(merged.get(1)!.markdown).not.toContain('<table');
    expect(merged.get(2)!.markdown).not.toContain('<table');
  });

  it('单行续页表格仍接回上一页，并保留下方脚注', () => {
    const first = page(
      '<table><tr><td>释义项</td><td>指</td><td>释义内容</td></tr>' +
        '<tr><td>TWh</td><td>指</td><td>太瓦时</td></tr></table>',
      '1',
    );
    const second = page(
      '<table><tr><td>报告期</td><td>指</td><td>2024年1月1日至2024年12月31日</td></tr></table>',
      '2',
      false,
    );
    const footnote = '注：尾数差异由四舍五入造成。';
    const markdown = `${second.markdown}\n\n${footnote}`;
    second.markdown = markdown;
    second.blocks = [
      second.blocks[0]!,
      second.blocks[1]!,
      block('text', footnote, 0.14, 0.03, markdown.indexOf(footnote)),
      second.blocks[2]!,
    ];

    const merged = mergeImageParseTables([
      { page: 1, result: first },
      { page: 2, result: second },
    ]);

    expect([...merged.keys()]).toEqual([0, 1]);
    expect(merged.get(0)!.markdown).toContain('报告期');
    expect(merged.get(1)!.markdown).not.toContain('<table');
    expect(merged.get(1)!.markdown).toContain(footnote);
  });

  it('列数不同、页首有正文或表格未贴近页底时不合并', () => {
    const twoColumns = page(
      '<table><tr><th>名称</th><th>数值</th></tr><tr><td>甲</td><td>1</td></tr></table>',
      '1',
    );
    const threeColumns = page(
      '<table><tr><th>名称</th><th>本期</th><th>上期</th></tr><tr><td>乙</td><td>2</td><td>3</td></tr></table>',
      '2',
      false,
    );
    expect(
      mergeImageParseTables([
        { page: 1, result: twoColumns },
        { page: 2, result: threeColumns },
      ]),
    ).toEqual(new Map());

    const textBeforeTable = page(
      `<table>${HEADER}<tr><td>乙</td><td>2</td><td>3</td></tr></table>`,
      '2',
      false,
    );
    const markdown = `说明\n\n${textBeforeTable.markdown}`;
    const tableStart = markdown.indexOf('<table');
    const textStart = markdown.indexOf('说明');
    textBeforeTable.markdown = markdown;
    textBeforeTable.blocks = [
      block('text', '说明', 0.05, 0.1, textStart),
      block('table', textBeforeTable.blocks[1]!.text, 0.2, 0.3, tableStart),
    ];
    expect(
      mergeImageParseTables([
        { page: 1, result: twoColumns },
        { page: 2, result: textBeforeTable },
      ]),
    ).toEqual(new Map());

    const first = page(`<table>${HEADER}<tr><td>甲</td><td>1</td><td>2</td></tr></table>`, '1');
    first.blocks = first.blocks.map((item) =>
      item.kind === 'table' ? { ...item, y: 0.2, h: 0.2 } : item,
    );
    const shallowTable = page(
      `<table>${HEADER}<tr><td>乙</td><td>2</td><td>3</td></tr></table>`,
      '2',
      false,
    );
    expect(
      mergeImageParseTables([
        { page: 1, result: first },
        { page: 2, result: shallowTable },
      ]),
    ).toEqual(new Map());
  });
});

describe('mergeImageParseTablesInPage', () => {
  it('把同一张图片中相邻且列数一致的表格合并成一个块', () => {
    const result = imageResult([
      '<table><tr><th>名称</th><th>数量</th></tr><tr><td>甲</td><td>1</td></tr></table>',
      '<table><tr><td>乙</td><td>2</td></tr></table>',
    ]);

    const merged = mergeImageParseTablesInPage(result);

    expect(merged).toBeDefined();
    expect(merged!.count).toBe(1);
    expect(merged!.result.markdown.match(/<table/g)).toHaveLength(1);
    expect(merged!.result.markdown.match(/<tr>/g)).toHaveLength(3);
    expect(merged!.result.blocks).toHaveLength(1);
    expect(merged!.result.blocks[0]).toMatchObject({ kind: 'table', ttsInvalid: true, y: 0.1 });
    expect(merged!.result.blocks[0]!.h).toBeCloseTo(0.41);
  });

  it('同一张图片内列数不同或中间有正文时不合并', () => {
    const differentColumns = imageResult([
      '<table><tr><th>名称</th><th>数量</th></tr></table>',
      '<table><tr><th>名称</th><th>数量</th><th>单位</th></tr></table>',
    ]);
    expect(mergeImageParseTablesInPage(differentColumns)).toBeUndefined();

    const first = '<table><tr><th>名称</th><th>数量</th></tr></table>';
    const text = '表格之间的说明';
    const second = '<table><tr><td>乙</td><td>2</td></tr></table>';
    const markdown = `${first}\n\n${text}\n\n${second}`;
    const separated: ImageParseSdkResult = {
      markdown,
      requestId: 'separated',
      blocks: [
        block('table', first, 0.1, 0.2, 0),
        block('text', text, 0.32, 0.05, markdown.indexOf(text)),
        block('table', second, 0.4, 0.2, markdown.indexOf(second)),
      ],
    };
    expect(mergeImageParseTablesInPage(separated)).toBeUndefined();
  });
});
