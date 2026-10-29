import { describe, expect, it } from 'vitest';

import { imageParseSealDisplayCrops, imageParseSealDisplayResult } from '../imageParseSealDisplay';
import type { ImageParseLayoutBlock } from '../imageParseSample';

const seal: ImageParseLayoutBlock = {
  id: 'seal-1',
  order: 1,
  label: 'seal',
  kind: 'seal',
  x: 0.1,
  y: 0.1,
  w: 0.2,
  h: 0.2,
  text: '印章文字',
  markdown: '印章文字',
  markdownStart: 12,
  markdownEnd: 16,
  confidence: null,
};

const image: ImageParseLayoutBlock = {
  id: 'image-1',
  order: 0,
  label: 'image',
  kind: 'image',
  x: 0.4,
  y: 0.1,
  w: 0.2,
  h: 0.2,
  text: '',
  markdown: '![image]()',
  markdownStart: 0,
  markdownEnd: 10,
  confidence: null,
};

const chart: ImageParseLayoutBlock = {
  id: 'chart-1',
  order: 2,
  label: 'chart',
  kind: 'chart',
  x: 0.1,
  y: 0.4,
  w: 0.2,
  h: 0.2,
  text: '图表文字',
  markdown: '图表文字',
  markdownStart: 18,
  markdownEnd: 22,
  confidence: null,
};

describe('印章展示派生', () => {
  it('关闭印章文字时只替换预览，不修改原始结果', () => {
    const result = { markdown: '![image]()\n\n印章文字', blocks: [image, seal] };
    const visible = imageParseSealDisplayResult(result, false, true);

    expect(visible.markdown).toBe('![image]()\n\n![image]()');
    expect(result.markdown).toBe('![image]()\n\n印章文字');
    expect(visible.blocks[1]?.markdown).toBe('![image]()');
  });

  it('图片模式显示全部图片，文字模式隐藏有文字印章裁图', () => {
    const crops = ['image-crop', 'seal-crop'];
    expect(imageParseSealDisplayCrops([image, seal], crops, false, true)).toEqual(crops);
    expect(imageParseSealDisplayCrops([image, seal], crops, true, true)).toEqual(['image-crop']);
  });

  it('关闭图表文字时只替换图表正文并保留图表裁图', () => {
    const result = { markdown: '![image]()\n\n印章文字\n\n图表文字', blocks: [image, seal, chart] };
    const visible = imageParseSealDisplayResult(result, true, false);

    expect(visible.markdown).toBe('![image]()\n\n印章文字\n\n![image]()');
    expect(
      imageParseSealDisplayCrops(
        [image, seal, chart],
        ['image-crop', 'seal-crop', 'chart-crop'],
        true,
        false,
      ),
    ).toEqual(['image-crop', 'chart-crop']);
  });
});
