import { describe, expect, it } from 'vitest';

import { adaptImageParseV2 } from '@/api/map/imageParseV2';
import { imageParseBlockRanges } from '../imageParseBlocks';
import { imageParseCropBlocks } from '../imageParseCrops';
import { sanitizeImageParseSnapshot } from '../imageParseHistorySnapshot';

const sealText = '全国统一发票监制章 国家税务总局 山东省税务局';

function adapt(markdown: string, inputs: Array<{ label: string; content: string }>) {
  return adaptImageParseV2({
    choices: [{ message: { content: markdown } }],
    ocr: {
      mode: 'standard',
      image_width: 1000,
      image_height: 1000,
      blocks: inputs.map((block, order) => ({
        ...block,
        order,
        status: block.content ? 'ok' : 'skipped_no_vlm',
        bbox: [10, order * 100, 500, order * 100 + 80],
      })),
    },
  });
}

describe('印章文字与正文定位映射', () => {
  it('印章匹配正文文字，保留相邻标题和发票代码的独立范围', () => {
    const source = `# 山东增值税电子专用发票\n\n${sealText}\n\n发票代码：037002100113`;
    const result = adapt(source, [
      { label: 'doc_title', content: '山东增值税电子专用发票' },
      { label: 'seal', content: sealText.replace(/ /g, '\n') },
      { label: 'text', content: '发票代码：037002100113' },
    ]);
    const ranges = imageParseBlockRanges(result.markdown, result.blocks);
    expect(result.markdown).toBe(source);
    expect(ranges.size).toBe(3);
    const range = ranges.get('ocr-1')!;
    expect(result.markdown.slice(range.start, range.end)).toBe(sealText);
    expect(ranges.get('ocr-0')!.end).toBeLessThan(range.start);
    expect(ranges.get('ocr-2')!.start).toBeGreaterThan(range.end);
  });

  it('同文印章各自绑定不同的正文位置', () => {
    const result = adapt(`${sealText}\n\n${sealText}`, [
      { label: 'seal', content: sealText },
      { label: 'seal', content: sealText },
    ]);
    const ranges = imageParseBlockRanges(result.markdown, result.blocks);
    expect(ranges.size).toBe(2);
    expect(ranges.get('ocr-0')!.end).toBeLessThan(ranges.get('ocr-1')!.start);
  });

  it('正文没有印章文字时不补写内容或伪造定位', () => {
    const result = adapt('发票代码', [
      { label: 'seal', content: sealText },
      { label: 'text', content: '发票代码' },
    ]);
    expect(result.markdown).toBe('发票代码');
    expect(imageParseBlockRanges(result.markdown, result.blocks).has('ocr-0')).toBe(false);
  });

  it('有文字的印章不占用其它图片的占位符或裁图位置', () => {
    const source = `![image]()\n\n${sealText}`;
    const result = adapt(source, [
      { label: 'image', content: '' },
      { label: 'seal', content: sealText },
    ]);
    const ranges = imageParseBlockRanges(result.markdown, result.blocks);
    expect(result.markdown).toBe(source);
    expect(ranges.size).toBe(2);
    const imageRange = ranges.get('ocr-0')!;
    const sealRange = ranges.get('ocr-1')!;
    expect(result.markdown.slice(imageRange.start, imageRange.end)).toBe('![image]()');
    expect(result.markdown.slice(sealRange.start, sealRange.end)).toBe(sealText);
    expect(imageParseCropBlocks(result.blocks, 1).map((block) => block.id)).toEqual(['ocr-0']);
  });

  it('没有识别文字的印章补写原图占位符并保留定位', () => {
    const result = adapt('发票代码', [
      { label: 'seal', content: '' },
      { label: 'text', content: '发票代码' },
    ]);
    expect(result.markdown).toBe('![image]()\n\n发票代码');
    const ranges = imageParseBlockRanges(result.markdown, result.blocks);
    expect(ranges.size).toBe(2);
    expect(result.markdown.slice(ranges.get('ocr-0')!.start, ranges.get('ocr-0')!.end)).toBe(
      '![image]()',
    );
    expect(imageParseCropBlocks(result.blocks, 1).map((block) => block.id)).toEqual(['ocr-0']);
  });

  it('已有图片占位符时只配对图片，空印章在阅读位置补自己的占位符', () => {
    const result = adapt('![image]()\n\n正文', [
      { label: 'image', content: '' },
      { label: 'seal', content: '' },
      { label: 'text', content: '正文' },
    ]);
    expect(result.markdown).toBe('![image]()\n\n![image]()\n\n正文');
    const ranges = imageParseBlockRanges(result.markdown, result.blocks);
    expect(ranges.size).toBe(3);
    expect(result.markdown.slice(ranges.get('ocr-0')!.start, ranges.get('ocr-0')!.end)).toBe(
      '![image]()',
    );
    expect(result.markdown.slice(ranges.get('ocr-1')!.start, ranges.get('ocr-1')!.end)).toBe(
      '![image]()',
    );
    expect(imageParseCropBlocks(result.blocks, 2).map((block) => block.id)).toEqual([
      'ocr-0',
      'ocr-1',
    ]);
  });

  it('没有识别文字的旧印章仍能绑定已有图片占位符', () => {
    const result = adapt('![image]()', [{ label: 'seal', content: '' }]);
    expect(result.blocks[0].markdown).toBe('![image]()');
    expect(imageParseBlockRanges(result.markdown, result.blocks).has('ocr-0')).toBe(true);
    expect(imageParseCropBlocks(result.blocks, 1)).toEqual(result.blocks);
  });

  it('恢复缺少印章映射的历史记录时重建定位且不改写正文', () => {
    const result = adapt(sealText, [{ label: 'seal', content: sealText }]);
    const snapshot = sanitizeImageParseSnapshot({
      attachment: {
        id: 'seal-invoice',
        name: 'invoice.png',
        kind: 'image',
        mime: 'image/png',
        size: 1,
        dataUrl: 'data:image/png;base64,AAA',
      },
      mode: 'standard',
      markdown: result.markdown,
      layout: result.blocks.map((block) => ({
        ...block,
        markdown: '',
        markdownStart: undefined,
        markdownEnd: undefined,
      })),
    });
    expect(snapshot?.markdown).toBe(sealText);
    expect(imageParseBlockRanges(snapshot!.markdown, snapshot!.layout).get('ocr-0')).toEqual({
      start: 0,
      end: sealText.length,
    });
  });
});
