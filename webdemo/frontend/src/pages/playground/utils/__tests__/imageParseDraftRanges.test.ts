import { describe, expect, it } from 'vitest';
import { imageParseDraftRanges } from '../imageParseDraftRanges';

const source = '标题\n\n公司\n\n地址\n\n电话\n\n表格';
const initial = new Map([
  ['title', { start: 0, end: 2 }],
  ['footer', { start: 4, end: 14 }],
  ['table', { start: 16, end: 18 }],
]);

describe('编辑后保留 OCR 原图定位', () => {
  it('更新当前页眉范围及后文偏移，重复编辑不使用旧偏移', () => {
    const first = source.replace('地址', '编辑后的地址');
    const ranges = imageParseDraftRanges(source, first, initial, { start: 8, end: 10 });
    expect(ranges.get('title')).toEqual(initial.get('title'));
    expect(first.slice(ranges.get('footer')!.start, ranges.get('footer')!.end)).toBe(
      '公司\n\n编辑后的地址\n\n电话',
    );
    expect(first.slice(ranges.get('table')!.start, ranges.get('table')!.end)).toBe('表格');
    const second = first.replace('标题', '更长的标题');
    const next = imageParseDraftRanges(first, second, ranges, { start: 0, end: 2 });
    expect(second.slice(next.get('title')!.start, next.get('title')!.end)).toBe('更长的标题');
    expect(second.slice(next.get('footer')!.start, next.get('footer')!.end)).toBe(
      '公司\n\n编辑后的地址\n\n电话',
    );
    expect(second.slice(next.get('table')!.start, next.get('table')!.end)).toBe('表格');
  });
  it('单个识别片段在编辑语义块内时映射完整新块，未改内容保持原位', () => {
    const before = '**原文**\n\n后文';
    const after = '新文字\n\n后文';
    const result = imageParseDraftRanges(
      before,
      after,
      new Map([
        ['text', { start: 2, end: 4 }],
        ['after', { start: 8, end: 10 }],
      ]),
      { start: 0, end: 6 },
    );
    expect(result.get('text')).toEqual({ start: 0, end: 3 });
    expect(result.get('after')).toEqual({ start: 5, end: 7 });
  });
  it('源码跨两个识别块的替换不猜测对应关系，仍保留其它区块', () => {
    const result = imageParseDraftRanges(
      source,
      '标题\n\n新段落\n\n表格',
      new Map([
        ['title', { start: 0, end: 2 }],
        ['company', { start: 4, end: 6 }],
        ['address', { start: 8, end: 10 }],
        ['table', { start: 16, end: 18 }],
      ]),
    );
    expect([...result.keys()]).toEqual(['title', 'table']);
    expect(result.get('table')).toEqual({ start: 9, end: 11 });
  });
  it('删除整个区块只清除该映射，未改动保存不重建映射', () => {
    expect(imageParseDraftRanges(source, source, initial)).toBe(initial);
    const after = source.slice(0, 4) + source.slice(14);
    const result = imageParseDraftRanges(source, after, initial, { start: 4, end: 14 });
    expect(result.has('footer')).toBe(false);
    expect(result.get('table')).toEqual({ start: 6, end: 8 });
  });
});
