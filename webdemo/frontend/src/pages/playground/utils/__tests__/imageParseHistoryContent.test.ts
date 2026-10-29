import { describe, expect, it } from 'vitest';

import { sameImageParseHistoryContent } from '../imageParseHistoryContent';
import type { ImageParseSnapshot } from '../imageParseHistoryTypes';

const image: ImageParseSnapshot = {
  attachment: {
    id: 'image',
    kind: 'image',
    name: 'scan.png',
    mime: 'image/png',
    size: 1,
    dataUrl: 'data:image/png;base64,YQ==',
  },
  mode: 'scored',
  markdown: '# Page 1',
  layout: [],
};
const pdf: ImageParseSnapshot = {
  ...image,
  attachment: {
    ...image.attachment,
    kind: 'file',
    name: 'scan.pdf',
    mime: 'application/pdf',
  },
  pdf: {
    page: 1,
    pages: 2,
    results: {
      1: { result: { markdown: '# Page 1', blocks: [] } },
      2: { error: 'imageParseRequestFailed' },
    },
  },
};

describe('sameImageParseHistoryContent', () => {
  it('空快照和任务类型变化均不视为已保存的相同内容', () => {
    expect(sameImageParseHistoryContent(null, pdf)).toBe(false);
    expect(sameImageParseHistoryContent(pdf, null)).toBe(false);
    expect(sameImageParseHistoryContent(image, { ...image, pdf: pdf.pdf })).toBe(false);
  });

  it('图片正文和布局的真实变化不跳过存档', () => {
    expect(sameImageParseHistoryContent(image, { ...image })).toBe(true);
    expect(sameImageParseHistoryContent(image, { ...image, markdown: '# Edited' })).toBe(false);
    expect(sameImageParseHistoryContent(image, { ...image, layout: [] })).toBe(false);
  });

  it('图片摆正角度变化需要存档，PDF 当前页角度投影不重复存档', () => {
    const rotation = {
      enabled: true,
      applied: true,
      totalAngle: 90,
      predictedAngle: 90,
      predictedScore: 0.97,
      confirmed: true,
      orientationAngle: 90,
      deskewAngle: 0,
      skippedReason: null,
    };
    expect(sameImageParseHistoryContent(image, { ...image, rotation })).toBe(false);
    expect(sameImageParseHistoryContent(pdf, { ...pdf, rotation })).toBe(true);
  });

  it('PDF 页数、附件和识别模式变化均需要存档', () => {
    expect(sameImageParseHistoryContent(pdf, { ...pdf, pdf: { ...pdf.pdf!, pages: 3 } })).toBe(
      false,
    );
    expect(
      sameImageParseHistoryContent(pdf, { ...pdf, attachment: { ...pdf.attachment, id: 'next' } }),
    ).toBe(false);
    expect(sameImageParseHistoryContent(pdf, { ...pdf, mode: 'standard' })).toBe(false);
  });

  it('PDF 新增、移除及更新失败页均需要存档', () => {
    const next = (results: NonNullable<ImageParseSnapshot['pdf']>['results']) => ({
      ...pdf,
      pdf: { ...pdf.pdf!, results },
    });
    expect(sameImageParseHistoryContent(pdf, next({ 1: pdf.pdf!.results[1] }))).toBe(false);
    expect(
      sameImageParseHistoryContent(
        pdf,
        next({ ...pdf.pdf!.results, 3: { error: 'imageParseRequestFailed' } }),
      ),
    ).toBe(false);
    expect(
      sameImageParseHistoryContent(
        pdf,
        next({ ...pdf.pdf!.results, 2: { error: 'documentPdfPassword' } }),
      ),
    ).toBe(false);
  });

  it('PDF 本地裁图变化和当前页的正文投影不属于云端内容变更', () => {
    expect(
      sameImageParseHistoryContent(pdf, {
        ...pdf,
        markdown: '',
        layout: [],
        pdf: {
          ...pdf.pdf!,
          page: 2,
          results: {
            ...pdf.pdf!.results,
            1: { ...pdf.pdf!.results[1], crops: ['local-image'] },
          },
        },
      }),
    ).toBe(true);
  });
});
