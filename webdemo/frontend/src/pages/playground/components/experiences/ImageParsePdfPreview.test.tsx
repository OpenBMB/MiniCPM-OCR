import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { useImageParse } from '../../hooks/useImageParse';
import { useImageParseDraft } from '../../hooks/useImageParseDraft';
import { ImageParseResultPane } from './ImageParseResultPane';
import { IMAGE_PARSE_SAMPLE_BLOCKS } from '../../utils/__tests__/imageParseSampleFixtures';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function pdfParse(page: number, count = 2, pendingFirst = false, pendingAll = false) {
  const results = Object.fromEntries(
    Array.from({ length: count }, (_, index) => {
      const number = index + 1;
      const markdown = `第${number}页正文`;
      return [
        number,
        pendingAll || (pendingFirst && number === 1)
          ? {}
          : {
              result: {
                markdown,
                blocks: [{ ...IMAGE_PARSE_SAMPLE_BLOCKS[2], id: 'same-id', markdown }],
              },
            },
      ];
    }),
  );
  return {
    resultKey: `pdf:${page}`,
    resultKeyForPage: (number: number) => `pdf:${number}`,
    markdown: results[page].result?.markdown ?? '',
    loading: pendingFirst || pendingAll,
    layout: results[page].result?.blocks ?? [],
    crops: [],
    attachment: { name: 'document.pdf' },
    pdf: {
      page,
      pages: count,
      results,
      loading: pendingFirst || pendingAll,
      setPage: vi.fn(),
    },
  } as unknown as ReturnType<typeof useImageParse>;
}

function Workspace({
  page = 1,
  count = 2,
  pendingFirst = false,
  pendingAll = false,
  onSelect = vi.fn(),
  parseState,
}: {
  page?: number;
  count?: number;
  pendingFirst?: boolean;
  pendingAll?: boolean;
  onSelect?: (id: string, page?: number) => void;
  parseState?: ReturnType<typeof useImageParse>;
}) {
  const parse = parseState ?? pdfParse(page, count, pendingFirst, pendingAll);
  const draft = useImageParseDraft(parse.markdown, parse.resultKey);
  return (
    <ImageParseResultPane
      parse={parse}
      draft={draft}
      selectedBlockId="same-id"
      onSelectBlock={onSelect}
    />
  );
}

describe('PDF 连续结果预览', () => {
  it('同时展示全部页，换页保留正文 DOM，并按页隔离同名块', () => {
    const onSelect = vi.fn();
    const { container, rerender } = render(<Workspace onSelect={onSelect} />);
    const first = screen.getByText('第1页正文', { selector: 'p' });
    expect(screen.getByText('第2页正文')).toBeInTheDocument();
    expect(screen.queryByText(/^documentPageNumber \d+$/)).toBeNull();
    expect(container.querySelectorAll('[data-ocr-highlight="true"]')).toHaveLength(1);
    fireEvent.click(screen.getByText('第2页正文'));
    expect(onSelect).toHaveBeenCalledWith('same-id', 2);
    rerender(<Workspace page={2} onSelect={onSelect} />);
    expect(screen.getByText('第1页正文', { selector: 'p' })).toBe(first);
    expect(container.querySelector('[data-ocr-highlight="true"]')).toHaveTextContent('第2页正文');
  });

  it('当前页尚未完成时保留已返回正文，不展示未返回页的空态和占位', () => {
    const { container } = render(<Workspace pendingFirst />);
    expect(screen.getByText('第2页正文')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /imageParsePreview/ })).toBeInTheDocument();
    expect(container.querySelector('[data-ocr-result-page="1"] [role="status"]')).toHaveTextContent(
      'documentPdfCurrentPage',
    );
    expect(
      container.querySelectorAll('[data-ocr-result-page="1"] [role="status"] .animate-spin'),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll('[data-ocr-result-page] [role="status"] .animate-spin'),
    ).toHaveLength(1);
    expect(screen.queryByText('imageParseEmpty')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-ocr-result-page]')).toHaveLength(2);
  });

  it('只有当前未完成页展示加载进度，其他未完成页只保留页码锚点', () => {
    const { container } = render(<Workspace page={1} count={3} pendingAll />);
    const current = container.querySelector('[data-ocr-result-page="1"] [role="status"]');
    const waiting = container.querySelector('[data-ocr-result-page="2"]');
    expect(container.querySelectorAll('[data-ocr-result-page]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-ocr-result-page] [role="status"]')).toHaveLength(1);
    expect(current?.querySelectorAll('.animate-spin')).toHaveLength(1);
    expect(current).toHaveTextContent('documentPdfProgress');
    expect(waiting?.querySelector('[role="status"]')).toBeNull();
    expect(waiting).toHaveTextContent('documentPdfCurrentPage');
    expect(waiting).not.toHaveTextContent('documentPdfProgress');
  });

  it.each([10, 40])('%i 页全部等待时只保留页码锚点，切换页码不产生空态', (count) => {
    const { container, rerender } = render(<Workspace page={2} count={count} pendingAll />);
    expect(container.querySelectorAll('[data-ocr-result-page]')).toHaveLength(
      count < 12 ? count : 1,
    );
    expect(container.querySelector('[data-ocr-result-page="2"] [role="status"]')).toHaveTextContent(
      'documentPdfCurrentPage',
    );
    expect(
      container.querySelector(`[data-ocr-result-page="${count}"] [role="status"]`),
    ).toBeNull();
    expect(screen.queryByText('imageParseEmpty')).not.toBeInTheDocument();
    rerender(<Workspace page={count} count={count} pendingAll />);
    expect(
      container.querySelector(`[data-ocr-result-page="${count}"] [role="status"]`),
    ).toBeInTheDocument();
    expect(screen.queryByText('imageParseEmpty')).not.toBeInTheDocument();
  });

  it('结果乱序返回时长文档保持虚拟骨架，当前页保持挂载', () => {
    const waiting = pdfParse(25, 40, false, true);
    const completed = pdfParse(25, 40);
    const results = Object.fromEntries(
      Array.from({ length: 14 }, (_, index) => {
        const page = index + 13;
        return [page, completed.pdf!.results[page]];
      }),
    );
    const { container, rerender } = render(
      <Workspace parseState={{ ...waiting, pdf: { ...waiting.pdf!, results } }} />,
    );
    const pages = container.querySelectorAll<HTMLElement>('[data-ocr-result-page]');
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveAttribute('data-ocr-result-page', '25');
    expect(pages[0]).toHaveAttribute('data-index', '24');
    const current = screen.getByText('第25页正文', { selector: 'p' });
    rerender(
      <Workspace
        parseState={{
          ...waiting,
          pdf: { ...waiting.pdf!, results: { ...results, 1: completed.pdf!.results[1] } },
        }}
      />,
    );
    expect(screen.getByText('第25页正文', { selector: 'p' })).toBe(current);
    expect(screen.queryByText('imageParseEmpty')).not.toBeInTheDocument();
  });

  it('停止解析且没有任何结果时提供逐页重试占位，不展示整栏空态', () => {
    const waiting = pdfParse(2, 10, false, true);
    const { container } = render(
      <Workspace
        parseState={{ ...waiting, loading: false, pdf: { ...waiting.pdf!, loading: false } }}
      />,
    );
    expect(screen.getAllByText('documentPdfPagePendingTitle')).toHaveLength(10);
    expect(screen.queryByText('imageParseParsing')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-ocr-result-page]')).toHaveLength(10);
  });

  it('单页失败仍保留错误和重试入口，其他未返回页显示待识别状态', () => {
    const waiting = pdfParse(2, 10, false, true);
    const retryPage = vi.fn();
    const { container } = render(
      <Workspace
        parseState={{
          ...waiting,
          loading: false,
          pdf: {
            ...waiting.pdf!,
            loading: false,
            results: { 3: { error: 'imageParseRequestFailed' } },
            retryPage,
          },
        }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('imageParseRequestFailed');
    expect(screen.getAllByText('documentPdfPagePendingTitle').length).toBeGreaterThan(0);
    const retryButton = container.querySelector<HTMLButtonElement>(
      '[data-ocr-result-page="3"] button',
    );
    if (!retryButton) throw new Error('第 3 页缺少重试按钮');
    fireEvent.click(retryButton);
    expect(retryPage).toHaveBeenCalledExactlyOnceWith(3);
  });

  it('长文档保留各页几何骨架，只挂载附近正文', () => {
    const { container } = render(<Workspace count={40} />);
    expect(container.querySelectorAll('[data-ocr-result-page]')).toHaveLength(1);
    expect(
      container.querySelectorAll('[data-ocr-result-page] [data-edit-block]').length,
    ).toBeLessThan(12);
    expect(screen.getByText('第1页正文', { selector: 'p' })).toBeInTheDocument();
  });
});
