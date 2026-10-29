import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PdfDocumentStage from './PdfDocumentStage';

const pdf = vi.hoisted(() => ({
  page: 1,
  pages: 3,
  scale: 1,
  rotation: 0,
  rendering: false,
  hasPreview: true,
  displayRotation: 0,
  error: undefined as string | undefined,
  renderScale: 1,
  frameScale: 1,
  visiblePageNumbers: [1, 2, 3],
  readyPageNumbers: [1, 2, 3],
  pageList: [1, 2, 3].map((pageNumber) => ({
    pageNumber,
    baseWidth: 600,
    baseHeight: 800,
    rotation: 0,
  })),
  setViewport: vi.fn(),
  setPageNode: vi.fn(),
  setPageCanvas: vi.fn(),
  onViewportScroll: vi.fn(),
  goTo: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  rotate: vi.fn(),
  reset: vi.fn(),
  retry: vi.fn(),
}));
vi.mock('../../hooks/usePdfPreview', () => ({ usePdfPreview: () => pdf }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const props = {
  attachment: {
    id: 'pdf',
    kind: 'file' as const,
    name: 'page.pdf',
    mime: 'application/pdf',
    size: 1,
    dataUrl: '/page.pdf',
  },
  onClear: vi.fn(),
};

describe('PDF 连续滚动预览', () => {
  it('should keep every PDF page in one continuous scroll viewport', () => {
    const { container } = render(<PdfDocumentStage {...props} />);
    const viewport = container.querySelector('[data-pdf-viewport]')!;
    const pages = viewport.querySelectorAll('[data-pdf-page]');
    expect(pages).toHaveLength(3);
    expect(Array.from(pages, (node) => node.getAttribute('data-pdf-page'))).toEqual([
      '1',
      '2',
      '3',
    ]);
    expect(viewport.querySelectorAll('canvas')).toHaveLength(3);
  });

  it('大 PDF 保留全部页面骨架但只为视口附近页面挂载 canvas', () => {
    pdf.pageList = Array.from({ length: 100 }, (_, index) => ({
      pageNumber: index + 1,
      baseWidth: 600,
      baseHeight: 800,
      rotation: 0,
    }));
    pdf.visiblePageNumbers = [24, 25, 26];
    const { container } = render(<PdfDocumentStage {...props} />);
    const viewport = container.querySelector('[data-pdf-viewport]')!;
    expect(viewport.querySelectorAll('[data-pdf-page]')).toHaveLength(100);
    expect(viewport.querySelectorAll('canvas')).toHaveLength(3);
    expect(
      Array.from(viewport.querySelectorAll('canvas'), (node) =>
        Number(node.parentElement?.getAttribute('data-pdf-page')),
      ),
    ).toEqual([24, 25, 26]);
  });

  it('首次渲染时保留连续页面和 canvas 挂载，仅在固定视口显示一个占位', () => {
    pdf.rendering = true;
    pdf.hasPreview = false;
    pdf.readyPageNumbers = [];
    const { container } = render(<PdfDocumentStage {...props} />);
    expect(container.querySelector('[data-pdf-page]')?.parentElement).toHaveClass('invisible');
    expect(container.querySelectorAll('[data-pdf-page]')).toHaveLength(pdf.pageList.length);
    expect(container.querySelectorAll('[data-pdf-viewport] canvas')).toHaveLength(
      pdf.visiblePageNumbers.length,
    );
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status').closest('[data-pdf-viewport]')).toBeNull();
  });
});
