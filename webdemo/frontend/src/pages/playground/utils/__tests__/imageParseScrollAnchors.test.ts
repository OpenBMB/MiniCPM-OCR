import { describe, expect, it } from 'vitest';

import { imageParseMappedProgress, imageParseScrollAnchors } from '../imageParseScrollAnchors';
import { IMAGE_PARSE_SAMPLE_BLOCKS } from './imageParseSampleFixtures';

function mappedDocument(points: Array<{ y: number; top: number }>) {
  const origin = document.createElement('div');
  const result = document.createElement('div');
  Object.defineProperty(origin, 'clientHeight', { value: 200 });
  Object.defineProperties(result, {
    clientHeight: { value: 200 },
    scrollHeight: { value: 1200 },
  });
  const raster = document.createElement('div');
  raster.dataset.imageRaster = '';
  raster.getBoundingClientRect = () => new DOMRect(0, 0, 400, 1000);
  origin.append(raster);
  const blocks = points.map(({ y, top }, index) => {
    const id = `block-${index}`;
    const paragraph = document.createElement('p');
    paragraph.dataset.ocrLinkedIds = JSON.stringify([id]);
    paragraph.getBoundingClientRect = () => new DOMRect(0, top, 400, 40);
    result.append(paragraph);
    return { ...IMAGE_PARSE_SAMPLE_BLOCKS[2], id, y };
  });
  return imageParseScrollAnchors(origin, result, blocks, 0);
}

describe('imageParseScrollAnchors', () => {
  it('排除原图末端不可达的块顶部，保留内部块映射和完整滚动范围', () => {
    const anchors = mappedDocument([
      { y: 0.4, top: 250 },
      { y: 0.9, top: 600 },
      { y: 0.95, top: 950 },
    ]);
    expect(imageParseMappedProgress(anchors, 0.5, 'origin')).toBeCloseTo(0.25);
    expect(imageParseMappedProgress(anchors, 0.75, 'origin')).toBeCloseTo(0.625);
    expect(imageParseMappedProgress(anchors, 0.625, 'result')).toBeCloseTo(0.75);
    expect(imageParseMappedProgress(anchors, 1, 'origin')).toBe(1);
    expect(imageParseMappedProgress(anchors, 1, 'result')).toBe(1);
  });

  it('结果末端不可达的块顶部不使反向映射提前结束', () => {
    const anchors = mappedDocument([
      { y: 0.2, top: 250 },
      { y: 0.4, top: 1200 },
      { y: 0.6, top: 1300 },
    ]);
    expect(imageParseMappedProgress(anchors, 0.5, 'origin')).toBeCloseTo(0.5);
    expect(imageParseMappedProgress(anchors, 0.75, 'result')).toBeCloseTo(0.75);
    expect(imageParseMappedProgress(anchors, 1, 'result')).toBe(1);
  });

  it('只有饱和块时仍能按完整文档的首尾联动', () => {
    const anchors = mappedDocument([{ y: 0.9, top: 600 }]);
    expect(anchors.length).toBeGreaterThan(0);
    expect(imageParseMappedProgress(anchors, 0.5, 'origin')).toBeCloseTo(0.5);
    expect(imageParseMappedProgress(anchors, 1, 'origin')).toBe(1);
  });

  it('PDF 第二页结果的滚动锚点使用当前页画布，不使用仍可见的第一页', () => {
    const origin = document.createElement('div');
    origin.dataset.pdfViewport = '';
    Object.defineProperties(origin, {
      clientHeight: { value: 200 },
      scrollHeight: { value: 2000 },
    });
    const result = document.createElement('div');
    Object.defineProperties(result, {
      clientHeight: { value: 200 },
      scrollHeight: { value: 1200 },
    });
    const first = document.createElement('canvas');
    first.getBoundingClientRect = () => new DOMRect(0, 0, 400, 800);
    const second = document.createElement('canvas');
    second.setAttribute('role', 'img');
    second.getBoundingClientRect = () => new DOMRect(0, 816, 400, 800);
    origin.append(first, second);
    const paragraph = document.createElement('p');
    paragraph.dataset.ocrLinkedIds = '["same-id"]';
    paragraph.getBoundingClientRect = () => new DOMRect(0, 400, 400, 40);
    result.append(paragraph);
    const blocks = [{ ...IMAGE_PARSE_SAMPLE_BLOCKS[2], id: 'same-id', y: 0.2 }];
    const anchors = imageParseScrollAnchors(origin, result, blocks, 0);
    expect(anchors[1]?.origin).toBeCloseTo((816 + 160) / 1800);
    expect(anchors[1]?.result).toBe(0.4);
  });

  it('PDF 当前页结果的首尾只映射到该页范围，不返回整份文档首尾', () => {
    const origin = document.createElement('div');
    origin.dataset.pdfViewport = '';
    origin.dataset.pdfCurrentPage = '2';
    origin.scrollTop = 1000;
    Object.defineProperties(origin, {
      clientHeight: { value: 200 },
      scrollHeight: { value: 2600 },
    });
    const result = document.createElement('div');
    Object.defineProperties(result, {
      clientHeight: { value: 200 },
      scrollHeight: { value: 1200 },
    });
    const page = document.createElement('div');
    page.dataset.pdfPage = '2';
    page.getBoundingClientRect = () => new DOMRect(0, 816 - origin.scrollTop, 400, 800);
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.getBoundingClientRect = page.getBoundingClientRect;
    page.append(canvas);
    origin.append(page);
    const paragraph = document.createElement('p');
    paragraph.dataset.ocrLinkedIds = '["same-id"]';
    paragraph.getBoundingClientRect = () => new DOMRect(0, 400 - result.scrollTop, 400, 40);
    result.append(paragraph);
    const blocks = [{ ...IMAGE_PARSE_SAMPLE_BLOCKS[2], id: 'same-id', y: 0.2 }];
    const anchors = imageParseScrollAnchors(origin, result, blocks, 0);
    const start = 816 / 2400;
    const end = (816 + 800 - 200) / 2400;

    expect(imageParseMappedProgress(anchors, 0, 'result')).toBeCloseTo(start);
    expect(imageParseMappedProgress(anchors, 1, 'result')).toBeCloseTo(end);
    expect(imageParseMappedProgress(anchors, start, 'origin')).toBe(0);
    expect(imageParseMappedProgress(anchors, end, 'origin')).toBe(1);
    for (const progress of [0, 0.2, 0.4, 0.8, 1]) {
      const mapped = imageParseMappedProgress(anchors, progress, 'result');
      expect(imageParseMappedProgress(anchors, mapped, 'origin')).toBeCloseTo(progress);
    }
    // When an offscreen canvas unmounts, or standard mode has no layout blocks, the current page skeleton still bounds the range.
    canvas.remove();
    const unrendered = imageParseScrollAnchors(origin, result, [], 0);
    expect(imageParseMappedProgress(unrendered, 0, 'result')).toBeCloseTo(start);
    expect(imageParseMappedProgress(unrendered, 1, 'result')).toBeCloseTo(end);
  });

  it('PDF 当前页短于视口时只居中该页，不滚到相邻页', () => {
    const origin = document.createElement('div');
    origin.dataset.pdfViewport = '';
    origin.dataset.pdfCurrentPage = '2';
    Object.defineProperties(origin, {
      clientHeight: { value: 600 },
      scrollHeight: { value: 2400 },
    });
    const page = document.createElement('div');
    page.dataset.pdfPage = '2';
    page.getBoundingClientRect = () => new DOMRect(0, 816, 400, 400);
    origin.append(page);
    const result = document.createElement('div');
    Object.defineProperties(result, {
      clientHeight: { value: 200 },
      scrollHeight: { value: 1200 },
    });
    const anchors = imageParseScrollAnchors(origin, result, [], 0);
    const centered = (816 - 100) / 1800;
    expect(imageParseMappedProgress(anchors, 0, 'result')).toBeCloseTo(centered);
    expect(imageParseMappedProgress(anchors, 0.5, 'result')).toBeCloseTo(centered);
    expect(imageParseMappedProgress(anchors, 1, 'result')).toBeCloseTo(centered);
  });

  it.each(['origin', 'result'] as const)('%s 两端不被重复的饱和锚点覆盖', (from) => {
    const anchors = [
      { origin: 0, result: 0.1 },
      { origin: 0.1, result: 0 },
      { origin: 0.5, result: 0.5 },
      { origin: 0.9, result: 1 },
      { origin: 1, result: 0.9 },
      { origin: 1, result: 0.95 },
    ];
    for (const progress of [0, 0.001, 0.25, 0.75, 0.999, 1]) {
      expect(imageParseMappedProgress(anchors, progress, from)).toBeCloseTo(progress);
    }
  });

  it('连续 PDF 使用全页骨架联动，当前页同名块不误匹配第一页', () => {
    const origin = document.createElement('div');
    origin.dataset.pdfViewport = '';
    origin.dataset.pdfCurrentPage = '2';
    const result = document.createElement('div');
    result.dataset.ocrContinuousPdf = '';
    Object.defineProperties(origin, {
      clientHeight: { value: 200 },
      scrollHeight: { value: 1800 },
    });
    Object.defineProperties(result, {
      clientHeight: { value: 200 },
      scrollHeight: { value: 1200 },
    });
    for (const page of [1, 2]) {
      const original = document.createElement('div');
      original.dataset.pdfPage = String(page);
      original.getBoundingClientRect = () => new DOMRect(0, (page - 1) * 900, 400, 900);
      origin.append(original);
      const section = document.createElement('section');
      section.dataset.ocrResultPage = String(page);
      section.getBoundingClientRect = () => new DOMRect(0, (page - 1) * 600, 400, 600);
      const paragraph = document.createElement('p');
      paragraph.dataset.ocrLinkedIds = '["same-id"]';
      paragraph.getBoundingClientRect = () => new DOMRect(0, (page - 1) * 600 + 150, 400, 40);
      section.append(paragraph);
      result.append(section);
    }
    const blocks = [{ ...IMAGE_PARSE_SAMPLE_BLOCKS[2], id: 'same-id', y: 0.3 }];
    const anchors = imageParseScrollAnchors(origin, result, blocks, 0);
    expect(imageParseMappedProgress(anchors, 0, 'result')).toBe(0);
    expect(imageParseMappedProgress(anchors, 1, 'result')).toBe(1);
    const target = anchors.find((anchor) => Math.abs(anchor.origin - 1070 / 1600) < 0.001);
    expect(target?.result).toBeCloseTo(650 / 1000);
  });
});
