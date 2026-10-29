import { describe, expect, it } from 'vitest';
import {
  imageParseBlockCanRegenerate,
  imageParseBlockConfidenceLevel,
  imageParseConfidenceLevel,
  imageParseQuality,
  qualityExcerpt,
} from '../imageParseQuality';
import { IMAGE_PARSE_SAMPLE_BLOCKS } from './imageParseSampleFixtures';

describe('原文档框色分级（第一期临时阈值）', () => {
  it.each([
    [0, 'error'],
    [0.199, 'error'],
    [0.2, 'low'],
    [0.5, 'low'],
    [0.8, 'low'],
    [0.979, 'low'],
    [0.98, 'low'],
    [0.989, 'low'],
    [0.99, 'high'],
    [0.999, 'high'],
    [1, 'high'],
  ] as const)('分数 %s 分级为 %s', (confidence, level) => {
    expect(imageParseConfidenceLevel(confidence)).toBe(level);
  });

  it('缺失与非法分数不参与红黄绿判断', () => {
    for (const value of [null, NaN, -0.01, 1.01]) {
      expect(imageParseConfidenceLevel(value)).toBe('neutral');
    }
  });

  it('框线和分数列采用相同的失败及跳过状态优先级', () => {
    const block = { ...IMAGE_PARSE_SAMPLE_BLOCKS[0], confidence: 0.99 };
    expect(imageParseBlockConfidenceLevel(block)).toBe('high');
    expect(imageParseBlockConfidenceLevel({ ...block, status: 'failed' })).toBe('error');
    expect(imageParseBlockConfidenceLevel({ ...block, status: 'skipped_no_vlm' })).toBe('neutral');
  });

  it('跨页表格合并前的分数不参与质量分级、复核与单块重算', () => {
    const block = { ...IMAGE_PARSE_SAMPLE_BLOCKS[0], confidence: 0.42, ttsInvalid: true };
    expect(imageParseBlockConfidenceLevel(block)).toBe('neutral');
    expect(imageParseQuality([block]).scored).toHaveLength(0);
    expect(imageParseQuality([block]).missing).toBe(1);
    expect(imageParseBlockCanRegenerate(block)).toBe(false);
  });

  it('框色分级与待审核筛选阈值相互独立', () => {
    // Blocks at 0.8 or above do not enter review, but the box turns green only at 99%.
    expect(imageParseConfidenceLevel(0.8)).toBe('low');
    expect(imageParseConfidenceLevel(0.98)).toBe('low');
    expect(imageParseConfidenceLevel(0.99)).toBe('high');
    const block = IMAGE_PARSE_SAMPLE_BLOCKS[0];
    expect(imageParseQuality([{ ...block, confidence: 0.8 }]).suggested).toHaveLength(0);
    expect(imageParseQuality([{ ...block, confidence: 0.5 }]).suggested).toHaveLength(1);
  });
});

describe('有依据的区块分数复核建议', () => {
  it('区分零分、阈值边界、缺失与非法分数，并保留阅读顺序', () => {
    const scores = [null, 0.8, 0, NaN, 1.1, -0.1, 0.79, 1];
    const result = imageParseQuality(
      scores.map((confidence, order) => ({
        ...IMAGE_PARSE_SAMPLE_BLOCKS[0],
        id: `block-${order}`,
        confidence,
      })),
    );
    expect(result.scored.map((item) => item.order)).toEqual([2, 3, 7, 8]);
    expect(result.suggested.map((item) => item.id)).toEqual(['block-2', 'block-6']);
    expect(result.suggested[0].score).toBe('0%');
    expect(result.missing).toBe(4);
  });

  it('仅把显示分数向下取整为整数百分比，复核建议仍依据服务原始分数', () => {
    const block = { ...IMAGE_PARSE_SAMPLE_BLOCKS[0], confidence: 0.799 };
    const result = imageParseQuality([block]);
    expect(result.scored[0].score).toBe('79%');
    expect(result.suggested).toHaveLength(1);
    expect(block.confidence).toBe(0.799);
  });

  it('真实结果缺失元数据时不生成建议', () => {
    expect(imageParseQuality([])).toEqual({
      scored: [],
      suggested: [],
      missing: 0,
      skipped: [],
      failed: [],
    });
  });
});

describe('复核列表摘要清洗', () => {
  const block = IMAGE_PARSE_SAMPLE_BLOCKS[0];

  it('丢弃无地址的图片占位，不再把 ![image]() 当成正文', () => {
    expect(qualityExcerpt({ ...block, text: '![image]()', markdown: '![image]()' })).toBe('');
    expect(qualityExcerpt({ ...block, text: '正文\n\n![image]()' })).toBe('正文');
    expect(qualityExcerpt({ ...block, text: '![](https://example.test/a.png)' })).toBe('');
  });

  it('链接只保留文字，HTML 表格只保留单元格文本', () => {
    expect(qualityExcerpt({ ...block, text: '[发票查验](https://example.test/check)' })).toBe(
      '发票查验',
    );
    expect(
      qualityExcerpt({ ...block, text: '<table><tr><td>项目</td><td>金额</td></tr></table>' }),
    ).toBe('项目 金额');
  });
});
