import { describe, expect, it } from 'vitest';

import {
  appendSelectionError,
  appendedPdfSnapshot,
  imagePageResult,
} from '../appendDocumentPlan';

describe('appendSelectionError', () => {
  it('接受多张图片和单份 PDF', () => {
    const image = new File(['png'], 'a.png', { type: 'image/png' });
    const other = new File(['png'], 'b.png', { type: 'image/png' });
    const pdf = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' });
    expect(appendSelectionError([image, other])).toBeUndefined();
    expect(appendSelectionError([pdf])).toBeUndefined();
  });

  it('多份 PDF 或和图片混选时拒绝', () => {
    const image = new File(['png'], 'a.png', { type: 'image/png' });
    const pdf = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' });
    expect(appendSelectionError([pdf, pdf])).toBe('documentOnePdf');
    expect(appendSelectionError([pdf, image])).toBe('documentOnePdf');
  });

  it('空文件和不受支持的类型沿用上传错误', () => {
    expect(appendSelectionError([])).toBe('documentEmptyFile');
    expect(
      appendSelectionError([new File(['text'], 'notes.txt', { type: 'text/plain' })]),
    ).toBe('imageParseOnlyImage');
  });
});

describe('appendedPdfSnapshot', () => {
  it('留下旧页结果，并打开第一张新页', () => {
    const snapshot = appendedPdfSnapshot(2, 4, {
      1: { result: { markdown: '第一页', blocks: [] } },
      2: { result: { markdown: '第二页', blocks: [] } },
      3: { result: { markdown: '不该留下', blocks: [] } },
    });
    expect(snapshot.pages).toBe(4);
    expect(snapshot.page).toBe(3);
    expect(snapshot.results[1]?.result?.markdown).toBe('第一页');
    expect(snapshot.results[2]?.result?.markdown).toBe('第二页');
    expect(snapshot.results[3]).toBeUndefined();
  });
});

describe('imagePageResult', () => {
  it('把已完成的单图收成第 1 页，空结果不当作已识别', () => {
    expect(imagePageResult({ markdown: '', blocks: [] })).toBeUndefined();
    expect(imagePageResult({ markdown: '正文', blocks: [] })?.[1]?.result?.markdown).toBe('正文');
  });
});
