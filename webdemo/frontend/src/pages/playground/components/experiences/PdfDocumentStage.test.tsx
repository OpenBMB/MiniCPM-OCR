import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@map/ui';

import PdfDocumentStage from './PdfDocumentStage';
import { imageParseBlockId } from '../../utils/imageParseBlocks';
import type { ImageParseLayoutBlock } from '../../utils/imageParseSample';
import { WORKSPACE_ICON_CONTROL } from '../../utils/imageParseWorkspaceStyles';
import type { PdfPageView } from '../../utils/pdfPreviewRender';

const pdf = vi.hoisted(() => ({
  page: 1,
  pages: 3,
  scale: 1,
  rotation: 0,
  rendering: false,
  hasPreview: true,
  displayRotation: undefined as number | undefined,
  error: undefined as string | undefined,
  renderScale: 1,
  frameScale: 1,
  pageList: [] as PdfPageView[],
  visiblePageNumbers: [1, 2, 3],
  readyPageNumbers: [1, 2, 3],
  setPageNode: vi.fn(),
  setPageCanvas: vi.fn(),
  onViewportScroll: vi.fn(),
  setViewport: vi.fn(),
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
const createPageList = (): PdfPageView[] =>
  [1, 2, 3].map((pageNumber) => ({
    pageNumber,
    baseWidth: 600,
    baseHeight: 800,
    rotation: 0,
  }));

const lowBlock: ImageParseLayoutBlock = {
  id: 'low',
  kind: 'text',
  x: 0,
  y: 0.8,
  w: 1,
  h: 0.1,
  confidence: 0.3,
  text: 'text',
  markdown: 'text',
};

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

describe('PdfDocumentStage origin plumbing', () => {
  beforeEach(() => {
    pdf.page = 1;
    pdf.pages = 3;
    pdf.scale = 1;
    pdf.rotation = 0;
    pdf.rendering = false;
    pdf.hasPreview = true;
    pdf.displayRotation = undefined;
    pdf.error = undefined;
    pdf.pageList = createPageList();
    pdf.readyPageNumbers = [1, 2, 3];
    vi.clearAllMocks();
  });

  it('页面缩略图独立于正文视口，点击后定位页码', async () => {
    const { container } = render(<PdfDocumentStage {...props} />);
    const rail = screen.getByRole('navigation', { name: 'imageParsePages' });
    expect(rail.querySelectorAll('[data-page-thumbnail]')).toHaveLength(3);
    expect(container.querySelector('[data-pdf-viewport]')).not.toContainElement(rail);
    await userEvent.click(screen.getAllByRole('button', { name: 'imageParseGoToPage' })[1]!);
    expect(pdf.goTo).toHaveBeenCalledWith(2);
  });

  it('首次加载占位固定在视口外层，页数、尺寸和滚动变化后不移动，画面就绪后不重建 canvas', () => {
    pdf.page = 2;
    pdf.pages = 0;
    pdf.rendering = true;
    pdf.hasPreview = false;
    pdf.pageList = [];
    pdf.readyPageNumbers = [];
    const { container, rerender } = render(<PdfDocumentStage {...props} />);
    const viewport = container.querySelector<HTMLElement>('[data-pdf-viewport]')!;
    const loading = screen.getByRole('status');
    expect(loading).toHaveTextContent('documentPdfLoading');
    expect(loading).toHaveClass('absolute', 'inset-0', 'items-center', 'justify-center');
    expect(loading.parentElement).toBe(viewport.parentElement);
    expect(loading.parentElement).toHaveClass('relative', 'min-h-0', 'flex-1');
    expect(viewport.contains(loading)).toBe(false);
    expect(loading.querySelector('[data-pdf-loading-page]')).toHaveAttribute('aria-hidden', 'true');
    expect(loading.querySelector('p')).toHaveClass('text-xs', 'text-muted-foreground');
    expect(container.querySelector('[data-pdf-toolbar]')).toHaveClass(
      'min-h-11',
      'py-1',
      '[@media(pointer:coarse)]:min-h-14',
    );
    expect(loading.querySelectorAll('.animate-pulse').length).toBeGreaterThan(2);
    for (const shape of loading.querySelectorAll('.animate-pulse, .animate-spin')) {
      expect(shape).toHaveClass('motion-reduce:animate-none');
    }
    pdf.pages = 3;
    pdf.pageList = createPageList();
    rerender(<PdfDocumentStage {...props} />);
    expect(screen.getAllByRole('status')).toEqual([loading]);
    expect(container.querySelectorAll('[data-pdf-loading-page]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-pdf-viewport] canvas')).toHaveLength(3);
    const canvas = container.querySelector('[data-pdf-viewport] canvas');
    expect(canvas).toHaveClass('invisible');
    expect(viewport.querySelector('[data-pdf-page]')?.parentElement).toHaveClass('invisible');

    pdf.scale = 1.5;
    pdf.pageList = createPageList().map((item) => ({ ...item, baseHeight: 1200 }));
    viewport.scrollTop = 1200;
    fireEvent.scroll(viewport);
    rerender(<PdfDocumentStage {...props} />);
    expect(screen.getAllByRole('status')).toEqual([loading]);
    expect(loading.parentElement).toBe(viewport.parentElement);
    expect(container.querySelector('[data-pdf-viewport] canvas')).toBe(canvas);

    pdf.rendering = false;
    pdf.hasPreview = true;
    pdf.readyPageNumbers = [1, 2, 3];
    rerender(<PdfDocumentStage {...props} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(container.querySelector('[data-pdf-loading-page]')).toBeNull();
    expect(container.querySelector('[data-pdf-viewport] canvas')).toBe(canvas);
    expect(canvas).toBeInTheDocument();
    expect(canvas).toBeVisible();
    rerender(<PdfDocumentStage {...props} />);
    expect(container.querySelector('[data-pdf-viewport] canvas')).toBe(canvas);
  });

  it('预览失败时移除加载骨架并保留重试入口', () => {
    pdf.rendering = true;
    pdf.hasPreview = false;
    pdf.readyPageNumbers = [];
    const { container, rerender } = render(<PdfDocumentStage {...props} />);
    pdf.error = 'documentPdfFailed';
    rerender(<PdfDocumentStage {...props} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(container.querySelector('[data-pdf-loading-page]')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('documentPdfFailed');
    fireEvent.click(screen.getByRole('button', { name: 'documentRetryPreview' }));
    expect(pdf.retry).toHaveBeenCalledOnce();
  });

  it.each([
    [0, [0.1, 0.2, 0.3, 0.4]],
    [90, [0.4, 0.1, 0.4, 0.3]],
    [180, [0.6, 0.4, 0.3, 0.4]],
    [270, [0.2, 0.6, 0.4, 0.3]],
    [360, [0.1, 0.2, 0.3, 0.4]],
  ])('旋转 %i 度后保留识别框和原始块定位，不显示分数', (rotation, coordinates) => {
    pdf.rotation = rotation as number;
    const block: ImageParseLayoutBlock = Object.freeze({
      kind: 'text',
      x: 0.1,
      y: 0.2,
      w: 0.3,
      h: 0.4,
      confidence: 0.73,
      text: 'original',
      markdown: 'original',
    });
    const id = imageParseBlockId(block, 0);
    const onSelectBlock = vi.fn();
    render(
      <PdfDocumentStage
        {...props}
        showBlocks
        blocks={[block]}
        selectedBlockId={id}
        onSelectBlock={onSelectBlock}
      />,
    );
    const button = screen.getByRole('button', { name: 'imageParseBlockNumber' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button.querySelector('[data-block-score]')).toBeNull();
    expect(button).toHaveAttribute('data-origin-block-id', id);
    expect(button.closest('[data-pdf-viewport]')).not.toBeNull();
    expect(document.querySelector('[data-image-score-rail]')).toBeNull();
    const style = button.parentElement!.style;
    [style.left, style.top, style.width, style.height].forEach((value, index) =>
      expect(parseFloat(value)).toBeCloseTo(coordinates[index]! * 100),
    );
    fireEvent.click(button);
    expect(onSelectBlock).toHaveBeenCalledWith(id);
    expect(onSelectBlock).toHaveBeenCalledOnce();
    expect([block.x, block.y, block.w, block.h]).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it('旋转重绘期间保留当前画面和匹配的旧框，完成后使用新方向坐标', () => {
    const block: ImageParseLayoutBlock = {
      id: 'low',
      kind: 'text',
      x: 0.1,
      y: 0.2,
      w: 0.3,
      h: 0.4,
      confidence: 0.3,
      text: 'original',
      markdown: 'original',
    };
    const stage = { ...props, showBlocks: true, blocks: [block], onSelectBlock: vi.fn() };
    const { rerender } = render(<PdfDocumentStage {...stage} />);
    pdf.rotation = 90;
    pdf.rendering = true;
    pdf.displayRotation = 0;
    rerender(<PdfDocumentStage {...stage} />);
    const frame = screen.getByRole('img', { name: 'documentPageLabel' });
    expect(frame).toBeVisible();
    expect(frame.parentElement).not.toHaveClass('invisible');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'imageParseBlockNumber' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'imageParseBlockNumber' }).parentElement!.style.left,
    ).toBe('10%');
    pdf.rendering = false;
    pdf.displayRotation = 90;
    rerender(<PdfDocumentStage {...stage} />);
    expect(screen.getByRole('button', { name: 'imageParseBlockNumber' })).toBeVisible();
    expect(
      parseFloat(
        screen.getByRole('button', { name: 'imageParseBlockNumber' }).parentElement!.style.left,
      ),
    ).toBeCloseTo(40);
    rerender(<PdfDocumentStage {...stage} showBlocks={false} />);
    expect(screen.queryByRole('button', { name: 'imageParseBlockNumber' })).toBeNull();
  });

  it('页码和图标操作统一使用工作台紧凑尺寸，并保留触屏尺寸', () => {
    render(<PdfDocumentStage {...props} />);
    const input = screen.getByRole('spinbutton', { name: 'documentPageNumber' });
    expect(input).toHaveClass('h-8', 'w-11', 'text-xs');
    expect(input).toHaveClass('[@media(pointer:coarse)]:h-11');
    expect(input).toHaveClass('[appearance:textfield]');
    for (const label of [
      'documentPreviousPage',
      'documentNextPage',
      'imageParseZoomIn',
      'imageParseZoomOut',
      'imageParseRotateRight',
    ]) {
      const button = screen.getByRole('button', { name: label });
      expect(button).toHaveClass(...WORKSPACE_ICON_CONTROL.split(' '));
      expect(button).toHaveAttribute('title', label);
    }
    expect(screen.getByRole('button', { name: 'documentPreviousPage' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'documentNextPage' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'imageParseZoomReset' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'imageParseZoomIn' }));
    fireEvent.click(screen.getByRole('button', { name: 'imageParseZoomOut' }));
    fireEvent.click(screen.getByRole('button', { name: 'imageParseRotateRight' }));
    expect(pdf.zoomIn).toHaveBeenCalledOnce();
    expect(pdf.zoomOut).toHaveBeenCalledOnce();
    expect(pdf.rotate).toHaveBeenCalledOnce();
    expect(pdf.reset).not.toHaveBeenCalled();
  });

  it('紧凑分页控件仍支持前后翻页和输入页码跳转', () => {
    render(<PdfDocumentStage {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'documentNextPage' }));
    expect(pdf.goTo).toHaveBeenCalledWith(2);
    const input = screen.getByRole('spinbutton', { name: 'documentPageNumber' });
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.blur(input);
    expect(pdf.goTo).toHaveBeenCalledWith(3);
    expect(input).toHaveValue(1);
  });

  it('PDF 原文栏不展示显示设置和评分说明', () => {
    const onToggleBlocks = vi.fn();
    const stageProps = {
      ...props,
      onToggleBlocks,
      blocks: [
        {
          id: 'low',
          kind: 'text' as const,
          x: 0.1,
          y: 0.2,
          w: 0.5,
          h: 0.1,
          confidence: 0.3,
          text: 'text',
          markdown: 'text',
        },
      ],
    };
    const { container, rerender } = render(<PdfDocumentStage {...stageProps} showBlocks />, {
      wrapper: TooltipProvider,
    });
    expect(screen.queryByRole('button', { name: 'imageParseDisplaySettings' })).toBeNull();
    expect(container.querySelector('[data-tour="image-parse-confidence-toggle"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'imageParseScoreHelp' })).toBeNull();
    rerender(<PdfDocumentStage {...stageProps} showBlocks={false} />);
    expect(screen.queryByRole('button', { name: 'imageParseDisplaySettings' })).toBeNull();
    expect(onToggleBlocks).not.toHaveBeenCalled();
  });

  it.each(['imageParseZoomOut', 'imageParseZoomIn', 'imageParseRotateRight', 'documentNextPage'])(
    'PDF 图标悬停显示统一 Tooltip：%s',
    async (label) => {
      const user = userEvent.setup();
      render(<PdfDocumentStage {...props} />);
      await user.hover(screen.getByRole('button', { name: label }));
      expect(await screen.findByRole('tooltip')).toHaveTextContent(label);
    },
  );

  it('should apply progress to the PDF viewport and report only user scrolling', () => {
    const onScrollProgress = vi.fn();
    const { container, rerender } = render(
      <PdfDocumentStage {...props} onScrollProgress={onScrollProgress} />,
    );
    const viewport = container
      .querySelector('[data-pdf-viewport] canvas')
      ?.closest('[data-pdf-viewport]') as HTMLDivElement;
    Object.defineProperties(viewport, {
      scrollHeight: { value: 1000 },
      clientHeight: { value: 200 },
    });
    rerender(
      <PdfDocumentStage {...props} scrollProgress={0.5} onScrollProgress={onScrollProgress} />,
    );
    expect(viewport.scrollTop).toBe(400);
    fireEvent.scroll(viewport);
    expect(onScrollProgress).toHaveBeenCalledWith(0.5, true);
    expect(pdf.onViewportScroll).not.toHaveBeenCalled();
    viewport.scrollTop = 600;
    fireEvent.scroll(viewport);
    expect(onScrollProgress).toHaveBeenCalledWith(0.75);
    expect(pdf.onViewportScroll).toHaveBeenCalledOnce();
  });

  it('should focus a selected block by scrolling only its containing PDF viewport', () => {
    const outerScroll = vi.fn();
    const { container, rerender } = render(
      <PdfDocumentStage
        {...props}
        showBlocks
        selectedBlockId="low"
        onSelectBlock={vi.fn()}
        blocks={[lowBlock]}
      />,
    );
    const selected = screen.getByRole('button', { name: 'imageParseBlockNumber' });
    selected.scrollIntoView = outerScroll;
    const viewport = container
      .querySelector('[data-pdf-viewport] canvas')
      ?.closest('[data-pdf-viewport]') as HTMLDivElement;
    Object.defineProperties(viewport, {
      clientHeight: { value: 200 },
      clientWidth: { value: 400 },
      scrollHeight: { value: 1000 },
      scrollWidth: { value: 400 },
    });
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ top: 0, left: 0 } as DOMRect);
    vi.spyOn(selected, 'getBoundingClientRect').mockReturnValue({
      top: 800,
      left: 0,
      width: 400,
      height: 100,
    } as DOMRect);
    rerender(
      <PdfDocumentStage
        {...props}
        showBlocks
        selectedBlockId="low"
        focusRequest={1}
        onSelectBlock={vi.fn()}
        blocks={[lowBlock]}
      />,
    );
    expect(viewport.scrollTop).toBe(750);
    expect(outerScroll).not.toHaveBeenCalled();
  });

  it('PDF 原图仅保留识别框和点击定位，不展示分数及重生成按钮', () => {
    const onSelectBlock = vi.fn();
    render(
      <PdfDocumentStage
        {...props}
        showBlocks
        selectedBlockId="low"
        onSelectBlock={onSelectBlock}
        blocks={[lowBlock]}
      />,
    );
    expect(screen.queryByRole('button', { name: 'imageParseRegenerateBlock' })).toBeNull();
    expect(document.querySelector('[data-block-score]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'imageParseBlockNumber' }));
    expect(onSelectBlock).toHaveBeenCalledWith('low');
  });
});
