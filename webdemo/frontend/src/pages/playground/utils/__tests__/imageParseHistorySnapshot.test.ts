import { describe, expect, it } from 'vitest';
import { sanitizeImageParseSnapshot } from '../imageParseHistorySnapshot';

const image = {
  id: 'uploaded',
  kind: 'image' as const,
  name: 'scan.png',
  mime: 'image/png',
  size: 12,
  dataUrl: 'data:image/png;base64,AAA',
};

describe('sanitizeImageParseSnapshot 未完成记录', () => {
  it('接受刚上传、还没有识别结果的图片', () => {
    expect(
      sanitizeImageParseSnapshot({
        attachment: image,
        mode: 'scored',
        markdown: '',
        layout: [],
      }),
    ).toMatchObject({ attachment: image, mode: 'scored', markdown: '', layout: [] });
  });

  it.each([
    ['image/gif', 'animated.gif', 'data:image/gif;base64,AAA'],
    ['image/webp', 'animated.webp', 'data:image/webp;base64,AAA'],
    ['image/avif', 'scan.avif', 'data:image/avif;base64,AAA'],
  ])('接受 %s 图片快照', (mime, name, dataUrl) => {
    const attachment = { ...image, name, mime, dataUrl };
    expect(
      sanitizeImageParseSnapshot({
        attachment,
        mode: 'scored',
        markdown: '',
        layout: [],
      }),
    ).toMatchObject({ attachment });
  });

  it('拒绝 SVG data URL', () => {
    expect(
      sanitizeImageParseSnapshot({
        attachment: {
          ...image,
          name: 'scan.svg',
          mime: 'image/svg+xml',
          dataUrl: 'data:image/svg+xml;base64,AAA',
        },
        mode: 'scored',
        markdown: '',
        layout: [],
      }),
    ).toBeNull();
  });

  it('接受刚上传、页数还未知的 PDF', () => {
    const pdf = {
      id: 'uploaded-pdf',
      kind: 'file' as const,
      name: 'scan.pdf',
      mime: 'application/pdf',
      size: 12,
      dataUrl: 'data:application/pdf;base64,AAA',
    };
    expect(
      sanitizeImageParseSnapshot({
        attachment: pdf,
        mode: 'scored',
        markdown: '',
        layout: [],
        pdf: { page: 1, pages: 0, results: {} },
      }),
    ).toMatchObject({ attachment: pdf, pdf: { page: 1, pages: 0, results: {} } });
  });

  it('印章允许空正文，信息抽取必须携带合法字段', () => {
    expect(
      sanitizeImageParseSnapshot({
        attachment: image,
        mode: 'seal',
        markdown: '',
        layout: [
          {
            kind: 'seal',
            x: 0,
            y: 0,
            w: 1,
            h: 1,
            text: '',
            markdown: '',
            confidence: null,
          },
        ],
      }),
    ).toMatchObject({ mode: 'seal', markdown: '' });

    expect(
      sanitizeImageParseSnapshot({
        attachment: image,
        mode: 'kie',
        fields: [' 店名 ', '金额'],
        markdown: '{"店名":"面壁智能"}',
        layout: [],
      }),
    ).toMatchObject({ mode: 'kie', fields: ['店名', '金额'] });

    expect(
      sanitizeImageParseSnapshot({
        attachment: image,
        mode: 'kie',
        markdown: '{}',
        layout: [],
      }),
    ).toBeNull();
  });

  it('算法文档档位与 LIS 档位分开保存，流水线档位拒绝 PDF', () => {
    expect(
      sanitizeImageParseSnapshot({
        attachment: image,
        mode: 'standard-pipeline',
        markdown: '# 算法结果',
        layout: [],
      }),
    ).toMatchObject({ mode: 'standard-pipeline', markdown: '# 算法结果' });
    const pdf = {
      id: 'uploaded-pdf',
      kind: 'file' as const,
      name: 'scan.pdf',
      mime: 'application/pdf',
      size: 12,
      dataUrl: 'data:application/pdf;base64,AAA',
    };
    expect(
      sanitizeImageParseSnapshot({
        attachment: pdf,
        mode: 'standard-pipeline',
        markdown: '',
        layout: [],
        pdf: { page: 1, pages: 0, results: {} },
      }),
    ).toBeNull();
  });

  it('印章拒绝 PDF，非抽取模式拒绝字段', () => {
    const pdf = {
      id: 'uploaded-pdf',
      kind: 'file' as const,
      name: 'scan.pdf',
      mime: 'application/pdf',
      size: 12,
      dataUrl: 'data:application/pdf;base64,AAA',
    };
    expect(
      sanitizeImageParseSnapshot({
        attachment: pdf,
        mode: 'seal',
        markdown: '',
        layout: [],
        pdf: { page: 1, pages: 0, results: {} },
      }),
    ).toBeNull();
    expect(
      sanitizeImageParseSnapshot({
        attachment: image,
        mode: 'scored',
        fields: ['店名'],
        markdown: '',
        layout: [],
      }),
    ).toBeNull();
  });

  it('KIE PDF 沿用原有分页历史结构并保留抽取字段', () => {
    const snapshot = {
      attachment: {
        id: 'kie-pdf', kind: 'file', name: 'contract.pdf', mime: 'application/pdf',
        size: 12, dataUrl: 'data:application/pdf;base64,AAA',
      },
      mode: 'kie',
      fields: ['合同编号'],
      markdown: '{"合同编号":"123"}',
      layout: [],
      pdf: {
        page: 1, pages: 2,
        results: { 1: { result: { markdown: '{"合同编号":"123"}', blocks: [] } } },
      },
    };
    expect(sanitizeImageParseSnapshot(snapshot)).toMatchObject({
      mode: 'kie', fields: ['合同编号'], pdf: snapshot.pdf,
    });
  });
});
