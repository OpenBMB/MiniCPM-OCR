import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@map/ui';

import { ImageParseStage } from './ImageParseStage';
import type { ImageParseLayoutBlock, ImageParseRotationInfo } from '../../utils/imageParseSample';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../hooks/useElementSize', () => {
  const empty = { width: 0, height: 0 };
  const measured = new WeakMap<HTMLElement, { width: number; height: number }>();
  return {
    useElementSize: (node: HTMLElement | null) => {
      if (!node) return empty;
      if (!measured.has(node))
        measured.set(node, {
          width: 400,
          height: node.hasAttribute('data-image-viewport') ? 300 : 1200,
        });
      return measured.get(node);
    },
  };
});

const block: ImageParseLayoutBlock = {
  id: 'low',
  kind: 'text',
  x: 0.1,
  y: 0.7,
  w: 0.8,
  h: 0.1,
  text: 'text',
  markdown: 'text',
  confidence: 0.4,
};
const props = {
  attachment: {
    id: 'image',
    kind: 'image' as const,
    name: 'page.png',
    mime: 'image/png',
    size: 1,
    dataUrl: '/page.png',
  },
  previewSrc: '/page.png',
  onPreview: vi.fn(),
  onClear: vi.fn(),
  blocks: [block],
  parsing: false,
  progress: null,
};

describe('ImageParseStage bounded origin', () => {
  it('原图操作统一为无浮框的图标工具条，并保留缩放', () => {
    const { container } = render(<ImageParseStage {...props} />);
    const toolbar = screen.getByRole('toolbar', { name: 'imageParseOriginal' });
    expect(toolbar.closest('[data-image-toolbar]')).toHaveClass(
      'min-h-11',
      'py-1',
      '[@media(pointer:coarse)]:min-h-14',
    );
    expect(toolbar.querySelector('.shadow-sm')).toBeNull();
    expect(screen.queryByRole('button', { name: 'imageParseFitWidth' })).toBeNull();
    for (const label of [
      'imageParseZoomOut',
      'imageParseZoomIn',
      'imageParseRotateLeft',
      'imageParseRotateRight',
      'imagePreview',
    ]) {
      const button = screen.getByRole('button', { name: label });
      expect(toolbar).toContainElement(button);
      expect(button.textContent).toBe('');
      expect(button).toHaveAttribute('title', label);
    }
    // Replacing a file is left to drag-and-drop and the top-bar entry. The bottom bar no longer keeps a replace button (t returns the key in tests).
    expect(screen.queryByRole('button', { name: 'imageParseReplace' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'imageParseZoomIn' }));
    expect(toolbar).toHaveTextContent('125%');
    fireEvent.click(screen.getByRole('button', { name: 'imageParseZoomOut' }));
    expect(toolbar).toHaveTextContent('100%');
    expect(container.querySelector('[data-image-raster]')).toHaveStyle({ width: '400px' });
  });

  it('解析中禁用文件操作，但仍允许浏览原图', () => {
    render(<ImageParseStage {...props} disabled />);
    expect(screen.getByRole('button', { name: 'imageParseZoomIn' })).toBeEnabled();
  });

  it('服务端摆正后旋转原图并提示页脚信息', () => {
    const rotation: ImageParseRotationInfo = {
      enabled: true,
      applied: true,
      totalAngle: 89.58,
      predictedAngle: 90,
      predictedScore: 0.97,
      confirmed: true,
      orientationAngle: 90,
      deskewAngle: -0.42,
      skippedReason: null,
    };
    const { container } = render(
      <ImageParseStage
        {...props}
        blocks={[{ ...block, kind: 'footer', label: 'footer' }]}
        rotation={rotation}
      />,
    );
    const measuring = container.querySelector<HTMLImageElement>('img[aria-hidden="true"]')!;
    Object.defineProperty(measuring, 'naturalWidth', { value: 800 });
    Object.defineProperty(measuring, 'naturalHeight', { value: 600 });
    fireEvent.load(measuring);

    expect(container.querySelector('[data-image-raster]')).toHaveAttribute(
      'data-image-server-rotation',
      '89.58',
    );
    const visible = screen.getByRole('img', { name: 'page.png' });
    expect(visible).toHaveStyle({ transform: 'rotate(-89.58deg)' });
    expect(container.querySelector('[data-image-rotation-badge]')).not.toBeNull();
    expect(container.querySelector('[data-image-footer-badge]')).not.toBeNull();
  });

  it('原文栏不展示显示设置和评分说明', () => {
    const stageProps = {
      ...props,
      onToggleBlocks: vi.fn(),
    };
    const { container, rerender } = render(<ImageParseStage {...stageProps} showBlocks />, {
      wrapper: TooltipProvider,
    });
    expect(screen.queryByRole('button', { name: 'imageParseDisplaySettings' })).toBeNull();
    expect(container.querySelector('[data-tour="image-parse-confidence-toggle"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'imageParseScoreHelp' })).toBeNull();
    rerender(<ImageParseStage {...stageProps} showBlocks={false} />);
    expect(screen.queryByRole('button', { name: 'imageParseDisplaySettings' })).toBeNull();
  });

  it('should start at fit width from the top and accept external progress without echo', async () => {
    const onScrollProgress = vi.fn();
    const { container, rerender } = render(
      <ImageParseStage {...props} onScrollProgress={onScrollProgress} />,
    );
    expect(container.querySelector('[data-image-raster]')).toHaveStyle({
      width: '400px',
      height: '1200px',
      transform: 'translate(-50%, -50%) translate(0px, 450px) rotate(0deg)',
    });
    expect(container.querySelector('[data-image-raster]')).not.toHaveClass('transition-transform');
    expect(onScrollProgress.mock.calls.every(([progress]) => progress === 0)).toBe(true);
    onScrollProgress.mockClear();
    rerender(
      <ImageParseStage {...props} scrollProgress={0.75} onScrollProgress={onScrollProgress} />,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-image-raster]')).toHaveStyle({
        transform: 'translate(-50%, -50%) translate(0px, -225px) rotate(0deg)',
      }),
    );
    expect(onScrollProgress).toHaveBeenCalledWith(0.75, true);
  });

  it('原图仅支持色块定位，外部定位只改变图片视口', () => {
    const scrollIntoView = vi.fn();
    const onSelectBlock = vi.fn();
    vi.stubGlobal('scrollTo', vi.fn());
    const { container } = render(
      <ImageParseStage
        {...props}
        showBlocks
        selectedBlockId="low"
        focusRequest={1}
        onSelectBlock={onSelectBlock}
      />,
    );
    container.querySelectorAll('*').forEach((node) => {
      node.scrollIntoView = scrollIntoView;
    });
    expect(screen.queryByRole('button', { name: 'imageParseRegenerateBlock' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'imageParseBlockNumber' }));
    expect(onSelectBlock).toHaveBeenCalledWith('low');
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(window.scrollTo).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('密集区域只显示识别框，点击仍能定位原始区块', () => {
    const onSelectBlock = vi.fn();
    const denseBlocks = [
      { ...block, id: 'first', y: 0.7, h: 0.01 },
      { ...block, id: 'second', y: 0.711, h: 0.01 },
    ];
    const { container } = render(
      <ImageParseStage {...props} blocks={denseBlocks} showBlocks onSelectBlock={onSelectBlock} />,
    );
    const viewport = container.querySelector('[data-image-viewport]')!;
    expect(viewport.querySelectorAll('[data-origin-block-id]')).toHaveLength(2);
    expect(container.querySelector('[data-image-score-rail]')).toBeNull();
    expect(viewport.querySelectorAll('[data-block-score]')).toHaveLength(0);
    const second = viewport.querySelector('[data-origin-block-id="second"]')!;
    fireEvent.click(second);
    expect(onSelectBlock).toHaveBeenCalledWith('second');
  });

  it('默认适宽的首次定位及双击恢复后定位均确认程序操作', () => {
    const onScrollProgress = vi.fn();
    const { container, rerender } = render(
      <ImageParseStage {...props} onScrollProgress={onScrollProgress} />,
    );
    for (const request of [1, 2]) {
      if (request === 2) {
        fireEvent.click(screen.getByRole('button', { name: 'imageParseZoomIn' }));
        fireEvent.doubleClick(container.querySelector('[data-image-viewport]')!);
        expect(screen.getByRole('toolbar', { name: 'imageParseOriginal' })).toHaveTextContent(
          '100%',
        );
      }
      onScrollProgress.mockClear();
      rerender(
        <ImageParseStage
          {...props}
          selectedBlockId="low"
          focusRequest={request}
          onScrollProgress={onScrollProgress}
        />,
      );
      expect(onScrollProgress).toHaveBeenLastCalledWith(expect.any(Number), true);
      expect(onScrollProgress.mock.calls.every(([, programmatic]) => programmatic === true)).toBe(
        true,
      );
    }
  });
});
