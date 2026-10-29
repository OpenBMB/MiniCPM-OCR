import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ImageParseLayoutBlock } from '../../utils/imageParseSample';
import PdfDocumentStage from './PdfDocumentStage';

const pdf = vi.hoisted(() => ({
  page: 2,
  pages: 3,
  scale: 1,
  rotation: 0,
  displayRotation: 0,
  rendering: false,
  error: undefined,
  frameScale: 1,
  visiblePageNumbers: [1, 2],
  readyPageNumbers: [1, 2],
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
  activatePage: vi.fn(),
  goTo: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  rotate: vi.fn(),
  retry: vi.fn(),
}));
vi.mock('../../hooks/usePdfPreview', () => ({ usePdfPreview: () => pdf }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const block: ImageParseLayoutBlock = {
  id: 'ocr-0',
  kind: 'text',
  x: 0.1,
  y: 0.2,
  w: 0.3,
  h: 0.1,
  text: 'first',
  markdown: 'first',
  confidence: 0.99,
};
const props = {
  attachment: {
    id: 'pdf',
    kind: 'file' as const,
    name: 'pages.pdf',
    mime: 'application/pdf',
    size: 1,
    dataUrl: '/pages.pdf',
  },
  onClear: vi.fn(),
  showBlocks: true,
  blocks: [{ ...block, text: 'second', confidence: 0.8 }],
  pageBlocks: { 1: [block], 2: [block], 3: [block] },
  onSelectBlock: vi.fn(),
};

describe('PDF 相邻页面识别框', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pdf.visiblePageNumbers = [1, 2];
    pdf.readyPageNumbers = [1, 2];
    pdf.rendering = false;
    pdf.rotation = 0;
    pdf.displayRotation = 0;
  });

  it('首次绘制完成前仅显示加载占位，不在空白画布上提前显示识别框', () => {
    pdf.readyPageNumbers = [];
    pdf.rendering = true;
    const { container, rerender } = render(<PdfDocumentStage {...props} />);
    expect(container.querySelectorAll('[data-pdf-viewport] canvas')).toHaveLength(2);
    expect(container.querySelectorAll('[data-origin-block-id]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-pdf-loading-page]')).toHaveLength(1);
    expect(container.querySelector('[data-pdf-viewport] [data-pdf-loading-page]')).toBeNull();

    pdf.readyPageNumbers = [2];
    pdf.rendering = false;
    rerender(<PdfDocumentStage {...props} />);
    expect(container.querySelector('[data-pdf-page="1"] [data-origin-block-id]')).toBeNull();
    expect(container.querySelector('[data-pdf-page="1"] [data-pdf-loading-page]')).not.toBeNull();
    expect(container.querySelector('[data-pdf-page="2"] [data-origin-block-id]')).not.toBeNull();
    expect(container.querySelector('[data-pdf-page="2"] [data-pdf-loading-page]')).toBeNull();
  });

  it('缩放重绘期间保留已就绪页面的框，不退回加载占位', () => {
    pdf.rendering = true;
    const { container } = render(<PdfDocumentStage {...props} />);
    expect(container.querySelectorAll('[data-origin-block-id]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-pdf-loading-page]')).toHaveLength(0);
  });

  it('当前在第二页时第一页仍保留自己的识别框，各页不再显示分数', () => {
    const { container } = render(<PdfDocumentStage {...props} selectedBlockId="ocr-0" />);
    expect(container.querySelector('[data-pdf-viewport]')).toHaveAttribute(
      'data-pdf-current-page',
      '2',
    );
    const first = container.querySelector('[data-pdf-page="1"] [data-origin-block-id="ocr-0"]');
    const second = container.querySelector('[data-pdf-page="2"] [data-origin-block-id="ocr-0"]');
    expect(first).not.toHaveTextContent('%');
    expect(first).toHaveAttribute('aria-pressed', 'false');
    expect(second).not.toHaveTextContent('%');
    expect(container.querySelector('[data-block-score]')).toBeNull();
    expect(second).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('[data-pdf-page="3"] [data-origin-block-id]')).toBeNull();
  });

  it('点击邻页框激活对应页并传递页码，不调用会改变原文位置的翻页操作', () => {
    const { container } = render(<PdfDocumentStage {...props} />);
    const first = container.querySelector('[data-pdf-page="1"] [data-origin-block-id="ocr-0"]')!;
    fireEvent.click(first);
    expect(pdf.activatePage).toHaveBeenCalledWith(1);
    expect(props.onSelectBlock).toHaveBeenCalledWith('ocr-0', 1);
    expect(pdf.goTo).not.toHaveBeenCalled();
  });

  it('邻页同名块不继承当前页悬停高亮，也不向当前页结果回写悬停', () => {
    const onHoverBlock = vi.fn();
    const { container } = render(
      <PdfDocumentStage {...props} hoveredBlockId="ocr-0" onHoverBlock={onHoverBlock} />,
    );
    const first = container.querySelector('[data-pdf-page="1"] [data-origin-block-id="ocr-0"]')!;
    const second = container.querySelector('[data-pdf-page="2"] [data-origin-block-id="ocr-0"]')!;
    expect(first).not.toHaveAttribute('data-origin-highlight');
    expect(second).toHaveAttribute('data-origin-highlight', 'true');
    fireEvent.mouseEnter(first);
    expect(onHoverBlock).not.toHaveBeenCalled();
  });

  it('旋转时每页框独立投影，隐藏识别框后全部页面都移除交互层', () => {
    pdf.rotation = 90;
    pdf.displayRotation = 90;
    const { container, rerender } = render(<PdfDocumentStage {...props} />);
    const first = container.querySelector<HTMLElement>(
      '[data-pdf-page="1"] [data-origin-block-id="ocr-0"]',
    )!;
    expect(parseFloat(first.parentElement!.style.left)).toBeCloseTo(70);
    expect(parseFloat(first.parentElement!.style.top)).toBeCloseTo(10);
    rerender(<PdfDocumentStage {...props} showBlocks={false} />);
    expect(container.querySelector('[data-origin-block-id]')).toBeNull();
  });

  it('未完成或失败的邻页没有识别框，不复用当前页结果', () => {
    const { container } = render(<PdfDocumentStage {...props} pageBlocks={{}} />);
    expect(container.querySelector('[data-pdf-page="1"] [data-origin-block-id]')).toBeNull();
    expect(container.querySelectorAll('[data-pdf-page="2"] [data-origin-block-id]')).toHaveLength(
      1,
    );
  });

  it('结果栏定位只查找当前页，不命中相邻页的同名框', () => {
    const { container, rerender } = render(<PdfDocumentStage {...props} selectedBlockId="ocr-0" />);
    const viewport = container.querySelector<HTMLElement>('[data-pdf-viewport]')!;
    const first = container.querySelector('[data-pdf-page="1"] [data-origin-block-id="ocr-0"]')!;
    const second = container.querySelector('[data-pdf-page="2"] [data-origin-block-id="ocr-0"]')!;
    Object.defineProperties(viewport, {
      clientHeight: { value: 200 },
      clientWidth: { value: 400 },
      scrollHeight: { value: 2000 },
      scrollWidth: { value: 400 },
    });
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 200));
    const firstBounds = vi.spyOn(first, 'getBoundingClientRect');
    vi.spyOn(second, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 800, 200, 100));
    rerender(<PdfDocumentStage {...props} selectedBlockId="ocr-0" focusRequest={1} />);
    expect(viewport.scrollTop).toBe(750);
    expect(firstBounds).not.toHaveBeenCalled();
  });
});
