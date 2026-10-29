import { render, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { useImageParse } from '../../hooks/useImageParse';
import type { PdfPageResult } from '../../utils/pdfImageParse';
import { ImageParseResultPane } from './ImageParseResultPane';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

interface KiePdfPageOptions {
  page?: number;
  pages?: number;
  results?: Record<number, PdfPageResult>;
  loading?: boolean;
}

function kiePdfParse({
  page = 1,
  pages = 3,
  results = {},
  loading = false,
}: KiePdfPageOptions = {}) {
  return {
    resultKey: `kie-pdf:${page}`,
    resultKeyForPage: (number: number) => `kie-pdf:${number}`,
    markdown: results[page]?.result?.markdown ?? '',
    loading,
    layout: [],
    crops: [],
    mode: 'kie',
    fields: ['合同编号', '甲方'],
    recognizeSeal: true,
    finished: false,
    pdf: {
      page,
      pages,
      results,
      loading,
      completed: Object.keys(results).length,
      setPage: vi.fn(),
      retryPage: vi.fn(),
    },
  } as unknown as ReturnType<typeof useImageParse>;
}

function renderKie(parse: ReturnType<typeof useImageParse>) {
  return render(
    <ImageParseResultPane
      parse={parse}
      draft={{
        value: parse.markdown,
        dirty: false,
        ranges: new Map(),
        setValue: vi.fn(),
        reset: vi.fn(),
      }}
      reviewEnabled={false}
    />,
  );
}

const firstPage = {
  result: { markdown: '{"合同编号":"A-1","甲方":"甲公司"}', blocks: [] },
};
const secondPage = {
  result: { markdown: '{"合同编号":"B-1","甲方":"乙公司"}', blocks: [] },
};

describe('关键信息抽取 PDF 结果', () => {
  it('多页文档抽取中复用文档解析的单一加载态，完成后再展示当前页摘要', () => {
    const { container } = renderKie(
      kiePdfParse({
        page: 1,
        results: { 1: firstPage, 2: secondPage },
        loading: true,
      }),
    );
    const preview = container.querySelector<HTMLElement>('[data-ocr-kie-pdf-result]');
    if (!preview) throw new Error('缺少信息抽取 PDF 结果');

    expect(container.querySelectorAll('[data-ocr-result-page]')).toHaveLength(1);
    expect(preview.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(preview.querySelectorAll('.animate-spin')).toHaveLength(1);
    expect(preview).toHaveTextContent('documentPdfCurrentPage');
    expect(preview).toHaveTextContent('documentPdfProgress');
    expect(within(preview).queryByRole('region', { name: 'imageParseKieResult' })).toBeNull();
  });

  it('当前页尚未完成时只展示一个页面加载态，不铺开其他页', () => {
    const { container } = renderKie(
      kiePdfParse({
        page: 1,
        results: { 2: secondPage },
        loading: true,
      }),
    );
    const preview = container.querySelector<HTMLElement>('[data-ocr-kie-pdf-result]');
    if (!preview) throw new Error('缺少信息抽取 PDF 结果');

    expect(container.querySelectorAll('[data-ocr-result-page]')).toHaveLength(1);
    expect(preview.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(preview.querySelectorAll('.animate-spin')).toHaveLength(1);
    expect(preview).toHaveTextContent('documentPdfCurrentPage');
  });

  it('切换页码后只渲染该页字段，不保留上一页内容', () => {
    const { container } = renderKie(
      kiePdfParse({
        page: 2,
        results: { 1: firstPage, 2: secondPage },
      }),
    );
    const preview = container.querySelector<HTMLElement>('[data-ocr-kie-pdf-result]');
    if (!preview) throw new Error('缺少信息抽取 PDF 结果');

    expect(within(preview).getByText('B-1')).toBeInTheDocument();
    expect(within(preview).queryByText('A-1')).toBeNull();
    expect(preview.querySelector('[role="status"]')).toBeNull();
  });
});
