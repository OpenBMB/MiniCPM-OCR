import { describe, expect, it } from 'vitest';

import { adaptImageParseV2 } from '@/api/map/imageParseV2';
import { imageParseBlockRanges } from '../imageParseBlocks';
import { hideImageParseHeaderFooter } from '../imageParseHeaderFooter';

function adapt(inputs: Array<{ content: string; label?: string; status?: string }>) {
  return adaptImageParseV2({
    choices: [{ message: { content: '' } }],
    ocr: {
      request_id: 'block-markdown',
      mode: 'stp',
      image_width: 1000,
      image_height: 1000,
      blocks: inputs.map((block, order) => ({
        order,
        label: block.label ?? 'text',
        status: block.status ?? 'ok',
        content: block.content,
        bbox: [10, order * 20, 100, order * 20 + 10],
        score: 0.9,
      })),
    },
  });
}

describe('预览按识别块生成', () => {
  it('两条要点各写一次，范围不重叠', () => {
    const first = '- MiniCPM-OCR 1.0 是 OCR 专用模型';
    const second = '- MiniCPM-OCR Jev 是解析结果决策模型';
    const result = adapt([
      { content: '核心定位：', label: 'paragraph_title' },
      { content: first },
      { content: second },
    ]);
    expect(result.markdown).toBe(`## 核心定位：\n\n${first}\n\n${second}`);
    const ranges = [...imageParseBlockRanges(result.markdown, result.blocks).values()];
    expect(ranges).toHaveLength(3);
    expect(ranges[1].end).toBeLessThanOrEqual(ranges[2].start);
  });

  it('同一句话两个块写成两段', () => {
    const result = adapt([{ content: '重复文字' }, { content: '重复文字' }]);
    expect(result.markdown).toBe('重复文字\n\n重复文字');
    const ranges = [...imageParseBlockRanges(result.markdown, result.blocks).values()];
    expect(ranges[0]).not.toEqual(ranges[1]);
  });

  it('三张图各自有占位符', () => {
    const result = adapt([
      { content: '', label: 'image', status: 'skipped_no_vlm' },
      { content: '', label: 'header_image', status: 'skipped_no_vlm' },
      { content: '', label: 'footer_image', status: 'skipped_no_vlm' },
    ]);
    expect(result.markdown).toBe('![image]()\n\n![image]()\n\n![image]()');
    expect(imageParseBlockRanges(result.markdown, result.blocks).size).toBe(3);
  });

  it('没有识别文字的印章保留原图占位符', () => {
    const result = adapt([
      { content: '发票代码：037002100113' },
      { content: '', label: 'seal', status: 'skipped_seal' },
    ]);
    expect(result.markdown).toBe('发票代码：037002100113\n\n![image]()');
    const ranges = imageParseBlockRanges(result.markdown, result.blocks);
    expect(ranges.size).toBe(2);
    expect(result.markdown.slice(ranges.get('ocr-1')!.start, ranges.get('ocr-1')!.end)).toBe(
      '![image]()',
    );
  });

  it('显示公式不再另写一份裸 LaTeX', () => {
    const formula = String.raw`\frac{p}{q}`;
    const result = adapt([
      { content: formula, label: 'display_formula' },
      { content: formula },
      { content: '后文' },
    ]);
    expect(result.markdown).toBe(`$$\n${formula}\n$$\n\n后文`);
  });

  it('关掉页眉页脚后其余块的位置后移', () => {
    const result = adapt([
      { content: '页眉', label: 'header' },
      { content: '标题', label: 'doc_title' },
      { content: '20', label: 'number' },
      { content: '正文' },
    ]);
    const hidden = hideImageParseHeaderFooter(result);
    expect(hidden.markdown).toBe('# 标题\n\n正文');
    const ranges = imageParseBlockRanges(hidden.markdown, hidden.blocks);
    expect(hidden.markdown.slice(ranges.get('ocr-1')!.start, ranges.get('ocr-1')!.end)).toBe(
      '# 标题',
    );
    expect(hidden.markdown.slice(ranges.get('ocr-3')!.start, ranges.get('ocr-3')!.end)).toBe(
      '正文',
    );
  });
});
