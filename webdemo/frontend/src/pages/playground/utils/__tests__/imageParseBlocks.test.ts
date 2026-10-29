import { describe, expect, it } from 'vitest';

import {
  imageParseBlockId,
  imageParseBlockRanges,
  imageParseConfidence,
} from '../imageParseBlocks';
import { IMAGE_PARSE_SAMPLE_BLOCKS } from './imageParseSampleFixtures';

const block = { ...IMAGE_PARSE_SAMPLE_BLOCKS[2], markdown: '重复文字' };

describe('OCR 块与 Markdown 映射', () => {
  it('按阅读顺序定位重复文字，允许坐标相同的不同块', () => {
    const ranges = imageParseBlockRanges('重复文字\n\n重复文字', [block, block]);
    expect(ranges.get(imageParseBlockId(block, 0))).toEqual({ start: 0, end: 4 });
    expect(ranges.get(imageParseBlockId(block, 1))).toEqual({ start: 6, end: 10 });
  });
  it('服务偏移优先定位重复文字，错误偏移与缺失片段不猜测', () => {
    const blocks = [
      { ...block, id: 'explicit', markdownStart: 6, markdownEnd: 10 },
      { ...block, id: 'missing', markdown: '不存在' },
      { ...block, id: 'invalid', markdownStart: 1, markdownEnd: 5 },
    ];
    expect([...imageParseBlockRanges('重复文字\n\n重复文字', blocks)]).toEqual([
      ['explicit', { start: 6, end: 10 }],
    ]);
  });
  it('有效分数统一向下取整为整数百分比，缺失或非法分数不补造', () => {
    expect([0, 0.4, 0.994, 0.999, 1, 0.375406687981454].map(imageParseConfidence)).toEqual([
      '0%',
      '40%',
      '99%',
      '99%',
      '100%',
      '37%',
    ]);
    expect([null, NaN, -0.1, 1.01].map(imageParseConfidence)).toEqual([null, null, null, null]);
  });
});
