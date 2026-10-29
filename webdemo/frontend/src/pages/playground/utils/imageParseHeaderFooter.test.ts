import { describe, expect, it } from 'vitest';
import { imageParseBlockRanges } from './imageParseBlocks';
import {
  hideImageParseHeaderFooter,
  stabilizeImageParseResult,
} from './imageParseHeaderFooter';
import type { ImageParseLayoutBlock } from './imageParseSample';

/** Join the body in fragment order and write an explicit offset on each block, simulating the output of reconcileImageParseMarkdown. */
function result(parts: Array<[ImageParseLayoutBlock['kind'], string]>) {
  let markdown = '';
  const blocks = parts.map(([kind, text], order) => {
    if (markdown) markdown += '\n\n';
    const start = markdown.length;
    markdown += text;
    return {
      id: `ocr-${order}`,
      order,
      kind,
      x: 0,
      y: order / 10,
      w: 1,
      h: 0.05,
      text,
      markdown: text,
      markdownStart: start,
      markdownEnd: markdown.length,
      confidence: null,
    } satisfies ImageParseLayoutBlock;
  });
  return { markdown, blocks };
}

describe('hideImageParseHeaderFooter', () => {
  it('删去页眉、页脚、页码的块和正文片段，不留多余空行', () => {
    const input = result([
      ['header', '某某公司 2024 年年度报告'],
      ['heading', '## 一、概况'],
      ['text', '正文第一段'],
      ['footer', '190'],
    ]);
    const out = hideImageParseHeaderFooter(input);
    expect(out.markdown).toBe('## 一、概况\n\n正文第一段');
    expect(out.blocks.map((block) => block.kind)).toEqual(['heading', 'text']);
  });

  it('其余块的偏移随之平移，仍能精确定位到原文', () => {
    const out = hideImageParseHeaderFooter(
      result([
        ['text', '甲'],
        ['header', '页眉在中间'],
        ['text', '乙乙'],
        ['footer', '页脚'],
        ['text', '丙'],
      ]),
    );
    expect(out.markdown).toBe('甲\n\n乙乙\n\n丙');
    const ranges = imageParseBlockRanges(out.markdown, out.blocks);
    expect([...ranges.values()].map(({ start, end }) => out.markdown.slice(start, end))).toEqual([
      '甲',
      '乙乙',
      '丙',
    ]);
  });

  it('没有页眉页脚时返回同一对象，不触发下游重算', () => {
    const input = result([['text', '只有正文']]);
    expect(hideImageParseHeaderFooter(input)).toBe(input);
  });

  it('不在正文里的页眉页脚只删块（服务端已跳过、未被补回的情况）', () => {
    const input = result([['text', '正文']]);
    const header = { ...input.blocks[0]!, id: 'h', kind: 'header' as const, markdown: '', markdownStart: undefined, markdownEnd: undefined };
    const out = hideImageParseHeaderFooter({ ...input, blocks: [header, ...input.blocks] });
    expect(out.markdown).toBe('正文');
    expect(out.blocks).toHaveLength(1);
  });

  it('为缺少服务端 id 的块补稳定 id，隐藏与恢复后正文块身份不变', () => {
    const input = result([
      ['header', '页眉'],
      ['heading', '## 正文标题'],
      ['text', '正文段落'],
      ['footer', '12'],
    ]);
    const withoutIds = {
      ...input,
      blocks: input.blocks.map(({ id: _id, ...block }) => block),
    };

    const stable = stabilizeImageParseResult(withoutIds);
    const bodyIds = stable.blocks.slice(1, 3).map((block) => block.id);
    const hidden = hideImageParseHeaderFooter(withoutIds);

    expect(hidden.blocks.map((block) => block.id)).toEqual(bodyIds);
    expect(stabilizeImageParseResult(withoutIds).blocks.map((block) => block.id)).toEqual(
      stable.blocks.map((block) => block.id),
    );
  });
});
