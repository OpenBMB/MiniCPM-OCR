/**
 * 图片缩放接线单测：滚轮改倍数、合帧、阻止页面滚动、按钮与拖拽。
 *
 * 这里测的是「事件真的到得了 hook」这一层，而不是几何算式（那在 utils/imageZoom 的单测里）。
 * 滚轮监听是 useWheelGesture 以非 passive 方式挂在 setViewport 给到的节点上的，
 * 一旦调用方没把 ref 接上，滚轮缩放会整个静默失效——这组测试就是为了让那种回归立刻可见。
 */

import { useCallback } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useImageZoom } from '../useImageZoom';
import { MAX_SCALE, MIN_SCALE } from '../../utils/imageZoom';

/** 按 hook 约定接线的最小看图器：视口挂 setViewport，内容挂 setContent。 */
function Viewer({ document = false }: { document?: boolean }) {
  const zoom = useImageZoom({ fitWidth: document });
  const { setViewport, setContent } = zoom;
  const viewportRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node && document)
        Object.defineProperties(node, {
          clientWidth: { configurable: true, value: 400 },
          clientHeight: { configurable: true, value: 300 },
        });
      setViewport(node);
    },
    [document, setViewport],
  );
  const contentRef = useCallback(
    (node: HTMLSpanElement | null) => {
      if (node && document)
        Object.defineProperties(node, {
          clientWidth: { configurable: true, value: 400 },
          clientHeight: { configurable: true, value: 1200 },
        });
      setContent(node);
    },
    [document, setContent],
  );
  return (
    <div
      ref={viewportRef}
      data-testid="viewport"
      onPointerDown={zoom.onPointerDown}
      onPointerMove={zoom.onPointerMove}
      onPointerUp={zoom.onPointerUp}
    >
      <span ref={contentRef} data-testid="content" style={{ transform: zoom.transform }} />
      <output data-testid="scale">{zoom.scale}</output>
      <output data-testid="transform">{zoom.transform}</output>
      <output data-testid="progress">{zoom.scrollProgress}</output>
      <button type="button" onClick={zoom.zoomIn}>
        in
      </button>
      <button type="button" onClick={zoom.zoomOut}>
        out
      </button>
      <button type="button" onClick={zoom.reset}>
        reset
      </button>
    </div>
  );
}

/** 滚轮按 requestAnimationFrame 合帧，所以断言前要把这一帧放过去。 */
async function flushFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  });
}

/**
 * 在视口上派发一个原生 wheel（React 的合成 wheel 是 passive 的，测不到真实路径）。
 * @returns 事件是否被 preventDefault
 */
function wheel(
  node: HTMLElement,
  deltaY: number,
  deltaMode = 0,
  modifiers: { ctrlKey?: boolean; metaKey?: boolean } = {},
  deltaX = 0,
): boolean {
  let prevented = false;
  act(() => {
    prevented = !node.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY,
        deltaX,
        deltaMode,
        clientX: 0,
        clientY: 0,
        ctrlKey: modifiers.ctrlKey,
        metaKey: modifiers.metaKey,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  return prevented;
}

function scale(): number {
  return Number(screen.getByTestId('scale').textContent);
}

describe('useImageZoom 滚轮', () => {
  it('zooms in on scroll up and out on scroll down', async () => {
    render(<Viewer />);
    const viewport = screen.getByTestId('viewport');

    // WHEEL_STEP=0.0015：一格 100px 对应 15%
    wheel(viewport, -100, 0, { ctrlKey: true });
    await flushFrame();
    expect(scale()).toBeCloseTo(1.15, 6);

    // 缩放按比例乘，所以反向滚同样格数不会精确回到 1（1.15 × 0.85 = 0.9775）。
    // 这是刻意的：等比缩放在任何倍数下手感一致，回到贴合走「还原」而不是数格数。
    wheel(viewport, 100, 0, { ctrlKey: true });
    await flushFrame();
    expect(scale()).toBeCloseTo(0.9775, 6);
  });

  it('coalesces a burst of wheel events into one frame', async () => {
    render(<Viewer />);
    const viewport = screen.getByTestId('viewport');

    // 一次滚动能打出上百个事件。合帧后按累计增量 -200 算一次（1.3），
    // 而不是逐个复利（1.15² ≈ 1.3225）——差值就是合帧生效的证据。
    wheel(viewport, -100, 0, { ctrlKey: true });
    wheel(viewport, -100, 0, { ctrlKey: true });
    await flushFrame();
    expect(scale()).toBeCloseTo(1.3, 6);
  });

  it('prevents the default so the page behind does not scroll', async () => {
    render(<Viewer />);
    expect(wheel(screen.getByTestId('viewport'), -100)).toBe(true);
    await flushFrame();
  });

  it('converts line-mode deltas so Firefox has the same feel', async () => {
    render(<Viewer />);
    // 行模式一格 deltaY 只有 ±3，按 LINE_HEIGHT=16 折算成 48px。
    wheel(screen.getByTestId('viewport'), -3, 1, { ctrlKey: true });
    await flushFrame();
    expect(scale()).toBeCloseTo(1.072, 6);
  });

  it('never leaves the scale range however hard the wheel is spun', async () => {
    render(<Viewer />);
    const viewport = screen.getByTestId('viewport');

    wheel(viewport, -100000, 0, { ctrlKey: true });
    await flushFrame();
    expect(scale()).toBe(MAX_SCALE);

    wheel(viewport, 100000, 0, { ctrlKey: true });
    await flushFrame();
    expect(scale()).toBe(MIN_SCALE);
  });
});

describe('useImageZoom bounded document viewport', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('should initially fit width at the top and vertically scroll with a plain wheel', async () => {
    render(<Viewer document />);
    const viewport = screen.getByTestId('viewport');
    expect(screen.getByTestId('transform')).toHaveTextContent('translate(0px, 450px)');
    expect(screen.getByTestId('progress')).toHaveTextContent('0');
    wheel(viewport, 100);
    await flushFrame();
    expect(scale()).toBe(1);
    expect(screen.getByTestId('transform')).toHaveTextContent('translate(0px, 350px)');
    wheel(viewport, 9000);
    await flushFrame();
    expect(screen.getByTestId('transform')).toHaveTextContent('translate(0px, -450px)');
    expect(screen.getByTestId('progress')).toHaveTextContent('1');
  });

  it('should only accept horizontal wheel pan once the image is wider than its viewport', async () => {
    render(<Viewer document />);
    const viewport = screen.getByTestId('viewport');
    wheel(viewport, 0, 0, {}, 100);
    await flushFrame();
    expect(screen.getByTestId('transform')).toHaveTextContent('translate(0px, 450px)');
    fireEvent.click(screen.getByText('in'));
    wheel(viewport, 0, 0, {}, 1000);
    await flushFrame();
    expect(screen.getByTestId('transform')).toHaveTextContent('translate(-50px, 450px)');
  });

  it('should re-clamp offsets when the viewport expands after zooming', async () => {
    const measure: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          measure.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    render(<Viewer document />);
    const viewport = screen.getByTestId('viewport');
    fireEvent.click(screen.getByText('in'));
    wheel(viewport, 9000, 0, {}, 9000);
    await flushFrame();
    Object.defineProperties(viewport, {
      clientWidth: { value: 800, configurable: true },
      clientHeight: { value: 2000, configurable: true },
    });
    act(() => measure.forEach((callback) => callback([], {} as ResizeObserver)));
    expect(screen.getByTestId('transform')).toHaveTextContent('translate(0px, -250px)');
  });

  it('should reset a scrolled document to fit width from the top', async () => {
    render(<Viewer document />);
    wheel(screen.getByTestId('viewport'), 300);
    await flushFrame();
    fireEvent.click(screen.getByText('in'));
    fireEvent.click(screen.getByText('reset'));
    expect(screen.getByTestId('transform')).toHaveTextContent('translate(0px, 450px)');
    expect(scale()).toBe(1);
  });

  it('should bound pointer pan at both ends and preserve the clamped view on release', () => {
    render(<Viewer document />);
    const viewport = screen.getByTestId('viewport');
    fireEvent.pointerDown(viewport, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(viewport, { clientX: 9000, clientY: -9000, pointerId: 1 });
    expect(screen.getByTestId('transform')).toHaveTextContent('translate(0px, -450px)');
    fireEvent.pointerUp(viewport, { pointerId: 1 });
    expect(screen.getByTestId('transform')).toHaveTextContent('translate(0px, -450px)');
  });
});

describe('useImageZoom 按钮与拖拽', () => {
  it('steps the scale with the buttons and returns home on reset', () => {
    render(<Viewer />);
    fireEvent.click(screen.getByText('in'));
    expect(scale()).toBeCloseTo(1.25, 6);
    fireEvent.click(screen.getByText('out'));
    expect(scale()).toBeCloseTo(1, 6);

    fireEvent.click(screen.getByText('in'));
    fireEvent.click(screen.getByText('reset'));
    expect(scale()).toBe(1);
    expect(screen.getByTestId('transform').textContent).toContain('translate(0px, 0px)');
  });

  it('pans one screen pixel per dragged pixel and stays put on release', () => {
    render(<Viewer />);
    const viewport = screen.getByTestId('viewport');

    fireEvent.pointerDown(viewport, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(viewport, { clientX: 130, clientY: 60, pointerId: 1 });
    // translate 在最外层，拖多少走多少。
    expect(screen.getByTestId('transform').textContent).toContain('translate(30px, -40px)');

    // 松手不归位：拖到哪停哪。
    fireEvent.pointerUp(viewport, { clientX: 130, clientY: 60, pointerId: 1 });
    expect(screen.getByTestId('transform').textContent).toContain('translate(30px, -40px)');
  });

  it('ignores a drag that did not start with the primary button', () => {
    render(<Viewer />);
    const viewport = screen.getByTestId('viewport');
    fireEvent.pointerDown(viewport, { button: 2, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(viewport, { clientX: 200, clientY: 200, pointerId: 1 });
    expect(screen.getByTestId('transform').textContent).toContain('translate(0px, 0px)');
  });
});
