import { describe, expect, it } from 'vitest';

import { imageParseBlockId, type ImageParseTextRange } from '../imageParseBlocks';
import {
  imageParsePageNumberRanges,
  imageParseRangeKey,
  isImageParsePageNumber,
} from '../imageParsePageNumber';
import type { ImageParseLayoutBlock } from '../imageParseSample';

function block(overrides: Partial<ImageParseLayoutBlock>): ImageParseLayoutBlock {
  return {
    order: 0,
    label: 'number',
    status: 'ok',
    kind: 'footer',
    x: 0,
    y: 0,
    w: 0.1,
    h: 0.02,
    text: '23',
    markdown: '23',
    confidence: 0.9,
    ...overrides,
  };
}

describe('OCR 页码识别', () => {
  it.each(['23', '第 23 页', '23页', '- 23 -', '23 / 100', 'Page 23', 'p.23'])(
    '识别常见页码格式：%s',
    (text) => expect(isImageParsePageNumber(text)).toBe(true),
  );

  it.each(['2023年', '23.5', '12345', '第23页正文', 'A-23', ''])(
    '不把普通数字或正文误判为页码：%s',
    (text) => expect(isImageParsePageNumber(text)).toBe(false),
  );

  it('只为页脚语义块生成页码范围，普通数字正文不参与', () => {
    const pageNumber = block({ id: 'page-number' });
    const bodyNumber = block({ id: 'body-number', kind: 'text', label: 'text' });
    const footerText = block({ id: 'footer-text', text: '公司机密', markdown: '公司机密' });
    const ranges = new Map<string, ImageParseTextRange>([
      [imageParseBlockId(pageNumber, 0), { start: 10, end: 12 }],
      [imageParseBlockId(bodyNumber, 1), { start: 20, end: 22 }],
      [imageParseBlockId(footerText, 2), { start: 30, end: 34 }],
    ]);

    const pageNumbers = imageParsePageNumberRanges(
      [pageNumber, bodyNumber, footerText],
      ranges,
    );

    expect([...pageNumbers]).toEqual([imageParseRangeKey({ start: 10, end: 12 })]);
  });
});
