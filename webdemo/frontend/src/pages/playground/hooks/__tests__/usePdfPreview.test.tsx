import { act, renderHook, waitFor } from '@testing-library/react';
import { Suspense, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PDFDocumentProxy } from 'pdfjs-dist';
import { usePdfPreview } from '../usePdfPreview';
import { usePdfPageRenderer } from '../usePdfPageRenderer';

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('../../utils/pdfPreview', () => ({ loadPdfPreview: mocks.load }));
vi.mock('../useElementSize', () => ({
  useElementSize: () => ({ width: 632, height: 500 }),
}));

interface PendingRender {
  canvas: HTMLCanvasElement;
  resolve: () => void;
  reject: (reason: Error) => void;
  cancel: ReturnType<typeof vi.fn>;
}

const renders: PendingRender[] = [];
const drawImage = vi.fn();
const page = {
  rotate: 0,
  cleanup: vi.fn(),
  getViewport: ({ scale, rotation }: { scale: number; rotation: number }) => ({
    scale,
    width: (rotation % 180 ? 800 : 600) * scale,
    height: (rotation % 180 ? 600 : 800) * scale,
  }),
  render: vi.fn(({ canvas }: { canvas: HTMLCanvasElement }) => {
    let resolve!: () => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<void>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    const cancel = vi.fn();
    renders.push({ canvas, resolve, reject, cancel });
    return { promise, cancel };
  }),
};
const documentProxy = {
  numPages: 2,
  getPage: vi.fn().mockResolvedValue(page),
} as unknown as PDFDocumentProxy;

async function setup(onPageChange?: (page: number) => void) {
  const viewport = document.createElement('div');
  const pageNodes = [1, 2].map((pageNumber) => {
    const node = document.createElement('div');
    node.dataset.pdfPage = String(pageNumber);
    viewport.appendChild(node);
    return node;
  });
  const canvases = pageNodes.map((node) => {
    const canvas = document.createElement('canvas');
    node.appendChild(canvas);
    return canvas;
  });
  Object.defineProperties(viewport, {
    clientHeight: { value: 500 },
    clientWidth: { value: 632 },
  });
  Object.defineProperties(pageNodes[0]!, {
    offsetTop: { value: 0 },
    offsetHeight: { value: 800 },
  });
  Object.defineProperties(pageNodes[1]!, {
    offsetTop: { value: 816 },
    offsetHeight: { value: 800 },
  });
  const hook = renderHook(({ source }) => usePdfPreview(source, undefined, onPageChange), {
    initialProps: { source: '/first.pdf' },
  });
  act(() => {
    hook.result.current.setViewport(viewport);
    pageNodes.forEach((node, index) => hook.result.current.setPageNode(index + 1, node));
    canvases.forEach((canvas, index) => hook.result.current.setPageCanvas(index + 1, canvas));
  });
  await waitFor(() => expect(hook.result.current.pageList).toHaveLength(2));
  await waitFor(() => expect(renders).toHaveLength(1));
  await act(async () => renders[0].resolve());
  return { ...hook, canvas: canvases[0], canvases, pageNodes, viewport };
}

function wheel(viewport: HTMLElement, options: WheelEventInit): WheelEvent {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...options });
  act(() => {
    viewport.dispatchEvent(event);
  });
  return event;
}

async function flushFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

function pointer(
  viewport: HTMLDivElement,
  clientX: number,
  clientY: number,
  options: { button?: number; pointerId?: number; pointerType?: string; target?: Element } = {},
): ReactPointerEvent<HTMLDivElement> {
  return {
    currentTarget: viewport,
    target: options.target ?? viewport,
    clientX,
    clientY,
    button: options.button ?? 0,
    pointerId: options.pointerId ?? 1,
    pointerType: options.pointerType ?? 'mouse',
    preventDefault: vi.fn(),
  } as unknown as ReactPointerEvent<HTMLDivElement>;
}

describe('PDF 预览后台绘制与原子提交', () => {
  beforeEach(() => {
    renders.length = 0;
    vi.clearAllMocks();
    mocks.load.mockImplementation(() => ({
      promise: Promise.resolve(documentProxy),
      destroy: vi.fn().mockResolvedValue(undefined),
    }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
  });
  afterEach(() => vi.restoreAllMocks());

  it('PDF 左键拖拽平移原文，横纵滚动限制在文档边界内', async () => {
    const { result, viewport } = await setup();
    Object.defineProperties(viewport, {
      scrollWidth: { value: 1000 },
      scrollHeight: { value: 1500 },
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: vi.fn() },
    });
    viewport.scrollLeft = 100;
    viewport.scrollTop = 200;
    expect(result.current).toHaveProperty('onPointerDown', expect.any(Function));
    act(() => result.current.onPointerDown(pointer(viewport, 200, 300)));
    expect(result.current.dragging).toBe(true);
    act(() => result.current.onPointerMove(pointer(viewport, 150, 220)));
    expect(viewport.scrollLeft).toBe(150);
    expect(viewport.scrollTop).toBe(280);
    act(() => result.current.onPointerMove(pointer(viewport, -1000, -2000)));
    expect(viewport.scrollLeft).toBe(368);
    expect(viewport.scrollTop).toBe(1000);
    act(() => result.current.onPointerMove(pointer(viewport, 2000, 2000)));
    expect(viewport.scrollLeft).toBe(0);
    expect(viewport.scrollTop).toBe(0);
    act(() => result.current.onPointerUp(pointer(viewport, 2000, 2000)));
    expect(result.current.dragging).toBe(false);
    expect(viewport.releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it('PDF 拖拽不接管右键、触屏原生滚动或识别框按钮点击', async () => {
    const { result, viewport } = await setup();
    const block = document.createElement('button');
    viewport.appendChild(block);
    expect(result.current).toHaveProperty('onPointerDown', expect.any(Function));
    for (const options of [{ button: 2 }, { pointerType: 'touch' }, { target: block }]) {
      const event = pointer(viewport, 100, 100, options);
      act(() => result.current.onPointerDown(event));
      expect(result.current.dragging).toBe(false);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
  });

  it('其他指针不能改变 PDF 拖拽，捕获丢失后立即停止平移', async () => {
    const { result, viewport } = await setup();
    Object.defineProperty(viewport, 'scrollWidth', { value: 1000 });
    viewport.scrollLeft = 100;
    expect(result.current).toHaveProperty('onPointerDown', expect.any(Function));
    act(() => result.current.onPointerDown(pointer(viewport, 200, 100)));
    act(() => {
      result.current.onPointerMove(pointer(viewport, 100, 100, { pointerId: 2 }));
      result.current.onPointerUp(pointer(viewport, 100, 100, { pointerId: 2 }));
    });
    expect(viewport.scrollLeft).toBe(100);
    expect(result.current.dragging).toBe(true);
    act(() => result.current.onPointerUp(pointer(viewport, 100, 100)));
    act(() => result.current.onPointerMove(pointer(viewport, 0, 100)));
    expect(viewport.scrollLeft).toBe(100);
    expect(result.current.dragging).toBe(false);
  });

  it('大 PDF 先发布完整页面骨架并渲染当前页，不等待所有页面尺寸测量完成', async () => {
    const largeDocument = {
      numPages: 100,
      getPage: vi.fn((pageNumber: number) =>
        pageNumber === 25 ? Promise.resolve(page) : new Promise<typeof page>(() => undefined),
      ),
    };
    mocks.load.mockImplementationOnce(() => ({
      promise: Promise.resolve(largeDocument),
      destroy: vi.fn().mockResolvedValue(undefined),
    }));
    const hook = renderHook(({ source, selectedPage }) => usePdfPreview(source, selectedPage), {
      initialProps: { source: '/large.pdf', selectedPage: 25 },
    });
    const viewport = document.createElement('div');
    const pageNode = document.createElement('div');
    const canvas = document.createElement('canvas');
    pageNode.appendChild(canvas);
    viewport.appendChild(pageNode);
    Object.defineProperty(viewport, 'clientWidth', { value: 632 });
    act(() => {
      hook.result.current.setViewport(viewport);
      hook.result.current.setPageNode(25, pageNode);
      hook.result.current.setPageCanvas(25, canvas);
    });
    await waitFor(() => expect(hook.result.current.pageList).toHaveLength(100));
    expect(hook.result.current.page).toBe(25);
    expect(largeDocument.getPage).toHaveBeenCalledWith(25);
    await waitFor(() => expect(renders).toHaveLength(1));
    await act(async () => renders[0].resolve());
    expect(hook.result.current.hasPreview).toBe(true);
    hook.unmount();
  });

  it('后台修正离屏页面尺寸时不取消当前页渲染', async () => {
    const canvas = document.createElement('canvas');
    const first = {
      pageNumber: 1,
      width: 600,
      height: 800,
      rotation: 0,
    };
    const initial = [first, { pageNumber: 2, width: 600, height: 800, rotation: 0 }];
    const visiblePageNumbers = [1];
    const hook = renderHook(
      ({ geometries }) =>
        usePdfPageRenderer({
          document: documentProxy,
          revision: 1,
          geometries,
          visiblePageNumbers,
          currentPage: 1,
          viewportWidth: 632,
          scale: 1,
          rotation: 0,
        }),
      { initialProps: { geometries: initial } },
    );
    act(() => hook.result.current.setPageCanvas(1, canvas));
    await waitFor(() => expect(renders).toHaveLength(1));
    hook.rerender({
      geometries: [first, { pageNumber: 2, width: 612, height: 792, rotation: 0 }],
    });
    expect(renders[0].cancel).not.toHaveBeenCalled();
    await act(async () => renders[0].resolve());
    expect(hook.result.current.hasPreview).toBe(true);
  });

  it('多页可见时优先绘制当前页，每页只绘制一次且提交不会取消后续任务', async () => {
    const visiblePageNumbers = [1, 2];
    const geometries = visiblePageNumbers.map((pageNumber) => ({
      pageNumber,
      width: 600,
      height: 800,
      rotation: 0,
    }));
    const hook = renderHook(() =>
      usePdfPageRenderer({
        document: documentProxy,
        revision: 0,
        geometries,
        visiblePageNumbers,
        currentPage: 2,
        viewportWidth: 632,
        scale: 1,
        rotation: 0,
      }),
    );
    act(() => {
      hook.result.current.setPageCanvas(1, document.createElement('canvas'));
      hook.result.current.setPageCanvas(2, document.createElement('canvas'));
    });
    await waitFor(() => expect(renders).toHaveLength(1));
    expect(hook.result.current).toHaveProperty('readyPageNumbers', []);
    expect(documentProxy.getPage).toHaveBeenLastCalledWith(2);
    await act(async () => renders[0].resolve());
    expect(hook.result.current.readyPageNumbers).toEqual([2]);
    await waitFor(() => expect(renders).toHaveLength(2));
    expect(renders[0].cancel).not.toHaveBeenCalled();
    expect(renders[1].cancel).not.toHaveBeenCalled();
    await act(async () => renders[1].resolve());
    expect(hook.result.current.readyPageNumbers).toEqual([1, 2]);
    expect(renders).toHaveLength(2);
    expect(hook.result.current.rendering).toBe(false);
  });

  it('绘制失败后停止自动重试，等待用户重试或调整视图', async () => {
    const { result } = await setup();
    act(() => result.current.rotate());
    await waitFor(() => expect(renders).toHaveLength(2));
    await act(async () => renders[1].reject(new Error('render failed')));
    expect(result.current.error).toBe('documentPdfFailed');
    expect(renders).toHaveLength(2);
    expect(result.current.rendering).toBe(false);
  });

  it('离屏 canvas 卸载后释放像素内存并清除对应预览状态', async () => {
    const { result, canvas } = await setup();
    expect(canvas.width * canvas.height).toBeGreaterThan(0);
    act(() => result.current.setPageCanvas(1, null));
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(result.current.hasPreview).toBe(false);
  });

  it('旋转过程中保留已完成画布和方向，新画面绘制完成后才同时更新尺寸与方向', async () => {
    const { result, canvas } = await setup();
    expect(renders[0].canvas).not.toBe(canvas);
    expect(result.current.hasPreview).toBe(true);
    expect(result.current.displayRotation).toBe(0);
    const oldWidth = canvas.width;
    const oldHeight = canvas.height;
    act(() => result.current.rotate());
    await waitFor(() => expect(renders).toHaveLength(2));
    expect(result.current.rendering).toBe(true);
    expect(result.current.hasPreview).toBe(true);
    expect(result.current.displayRotation).toBe(0);
    expect(canvas.width).toBe(oldWidth);
    expect(canvas.height).toBe(oldHeight);
    expect(drawImage).toHaveBeenCalledOnce();
    const { width, height } = renders[1].canvas;
    await act(async () => renders[1].resolve());
    expect(result.current.rendering).toBe(false);
    expect(result.current.displayRotation).toBe(90);
    expect(canvas.width).toBe(width);
    expect(canvas.height).toBe(height);
    expect(renders[1].canvas.width).toBe(0);
    expect(drawImage).toHaveBeenCalledTimes(2);
  });

  it('并发渲染尚未提交时不提前更新像素，方向与画布在布局提交时同时生效', async () => {
    const canvas = document.createElement('canvas');
    const geometries = [{ pageNumber: 1, width: 600, height: 800, rotation: 0 }];
    const visiblePageNumbers = [1];
    let release!: () => void;
    let blocked = true;
    const pending = new Promise<void>((resolve) => {
      release = () => {
        blocked = false;
        resolve();
      };
    });
    const hook = renderHook(
      ({ rotation }) => {
        const renderer = usePdfPageRenderer({
          document: documentProxy,
          revision: 0,
          geometries,
          visiblePageNumbers,
          currentPage: 1,
          viewportWidth: 632,
          scale: 1,
          rotation,
        });
        if (renderer.displayRotation === 90 && blocked) throw pending;
        return renderer;
      },
      {
        initialProps: { rotation: 0 },
        wrapper: ({ children }: { children: ReactNode }) => (
          <Suspense fallback={null}>{children}</Suspense>
        ),
      },
    );
    act(() => hook.result.current.setPageCanvas(1, canvas));
    await waitFor(() => expect(renders).toHaveLength(1));
    await act(async () => renders[0].resolve());
    expect(canvas.height).toBe(800);
    hook.rerender({ rotation: 90 });
    await waitFor(() => expect(renders).toHaveLength(2));
    await act(async () => renders[1].resolve());
    expect(canvas.height).toBe(800);
    expect(drawImage).toHaveBeenCalledOnce();
    await act(async () => release());
    expect(hook.result.current.displayRotation).toBe(90);
    expect(canvas.height).toBe(450);
    expect(drawImage).toHaveBeenCalledTimes(2);
  });

  it('快速连续旋转取消旧任务，过期任务完成不会覆盖最后一帧', async () => {
    const { result } = await setup();
    act(() => result.current.rotate());
    await waitFor(() => expect(renders).toHaveLength(2));
    act(() => result.current.rotate());
    await waitFor(() => expect(renders).toHaveLength(3));
    expect(result.current.error).toBeUndefined();
    expect(result.current.rendering).toBe(true);
    expect(renders[1].cancel).toHaveBeenCalledOnce();
    await act(async () => renders[1].resolve());
    expect(result.current.displayRotation).toBe(0);
    expect(drawImage).toHaveBeenCalledOnce();
    await act(async () => renders[2].resolve());
    expect(result.current.displayRotation).toBe(180);
    expect(drawImage).toHaveBeenCalledTimes(2);
  });

  it('连续滚动先渲染当前页，定位到下一页后才渲染下一页', async () => {
    const { result } = await setup();
    expect(result.current.pageList.map((page) => page.pageNumber)).toEqual([1, 2]);
    expect(renders).toHaveLength(1);
    act(() => result.current.goTo(2));
    await waitFor(() => expect(renders).toHaveLength(2));
    expect(documentProxy.getPage).toHaveBeenLastCalledWith(2);
  });

  it('连续滚动时根据视口中心更新当前页', async () => {
    const onPageChange = vi.fn();
    const { result, viewport } = await setup(onPageChange);
    act(() => {
      viewport.scrollTop = 900;
      result.current.onViewportScroll();
    });
    expect(result.current.page).toBe(2);
    expect(onPageChange).toHaveBeenLastCalledWith(2);
    act(() => {
      viewport.scrollTop = 0;
      result.current.onViewportScroll();
    });
    expect(result.current.page).toBe(1);
    expect(onPageChange).toHaveBeenLastCalledWith(1);
  });

  it('点击邻页只更新当前页，不改变原文视口位置，并拒绝越界页码', async () => {
    const onPageChange = vi.fn();
    const { result, viewport } = await setup(onPageChange);
    viewport.scrollTop = 600;
    act(() => result.current.activatePage(2));
    expect(result.current.page).toBe(2);
    expect(viewport.scrollTop).toBe(600);
    expect(onPageChange).toHaveBeenLastCalledWith(2);
    act(() => {
      result.current.activatePage(0);
      result.current.activatePage(3);
      result.current.activatePage(1.5);
    });
    expect(result.current.page).toBe(2);
    expect(onPageChange).toHaveBeenCalledOnce();
  });

  it('缩放也保留当前画面，换页或换文档不能把旧页当作新页展示', async () => {
    const { result, rerender } = await setup();
    act(() => result.current.zoomIn());
    await waitFor(() => expect(renders).toHaveLength(2));
    expect(result.current.hasPreview).toBe(true);
    act(() => result.current.goTo(2));
    await waitFor(() => expect(renders).toHaveLength(3));
    expect(result.current.hasPreview).toBe(false);
    await act(async () => renders[2].resolve());
    expect(result.current.hasPreview).toBe(true);
    await act(async () => rerender({ source: '/second.pdf' }));
    expect(result.current.hasPreview).toBe(false);
  });

  it('渲染失败报告错误，取消和卸载后的完成不提交画布', async () => {
    const { result, unmount } = await setup();
    act(() => result.current.rotate());
    await waitFor(() => expect(renders).toHaveLength(2));
    await act(async () => renders[1].reject(new Error('render failed')));
    expect(result.current.error).toBe('documentPdfFailed');
    expect(drawImage).toHaveBeenCalledOnce();
    act(() => result.current.rotate());
    await waitFor(() => expect(renders).toHaveLength(3));
    expect(result.current.error).toBeUndefined();
    expect(result.current.rendering).toBe(true);
    unmount();
    expect(renders[2].cancel).toHaveBeenCalledOnce();
    await act(async () => renders[2].resolve());
    expect(drawImage).toHaveBeenCalledOnce();
  });

  it('滚轮缩放先平滑延展旧画面，停止后再重绘新倍率', async () => {
    const { result, canvas, viewport } = await setup();
    const oldBitmapWidth = canvas.width;
    wheel(viewport, { deltaY: -100, ctrlKey: true });
    await flushFrame();
    expect(result.current.scale).toBeCloseTo(1.15);
    expect(result.current.renderScale).toBe(1);
    expect(renders).toHaveLength(1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 220));
    });
    await waitFor(() => expect(renders).toHaveLength(2));
    expect(result.current.renderScale).toBeCloseTo(1.15);
    expect(result.current.frameScale).toBe(1);
    await act(async () => renders[1].resolve());
    expect(result.current.frameScale).toBeCloseTo(1.15);
    expect(canvas.width).toBeGreaterThan(oldBitmapWidth);
    expect(canvas.style.width).toBe('100%');
    expect(canvas.style.height).toBe('100%');
    expect(canvas.style.transform).toBe('');
  });

  it('滚轮缩放按指针位置锚定滚动，避免视口内容跳动', async () => {
    const { result, viewport } = await setup();
    viewport.scrollTop = 100;
    viewport.scrollLeft = 20;
    wheel(viewport, { deltaY: -100, ctrlKey: true, clientX: 100, clientY: 200 });
    await flushFrame();
    expect(result.current.scale).toBeCloseTo(1.15);
    expect(viewport.scrollTop).toBeCloseTo(145);
    expect(viewport.scrollLeft).toBeCloseTo(38);
  });

  it.each(['ctrlKey', 'metaKey'])('%s 配合滚轮缩放 PDF 并阻止浏览器默认缩放', async (modifier) => {
    const { result, canvas, viewport } = await setup();
    const oldBitmapWidth = canvas.width;
    expect(wheel(viewport, { deltaY: -100, [modifier]: true }).defaultPrevented).toBe(true);
    await flushFrame();
    expect(result.current.scale).toBeCloseTo(1.15);
    expect(result.current.hasPreview).toBe(true);
    expect(renders).toHaveLength(1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    await waitFor(() => expect(renders).toHaveLength(2));
    await act(async () => renders[1].resolve());
    expect(canvas.width).toBeGreaterThan(oldBitmapWidth);
    wheel(viewport, { deltaY: 100, [modifier]: true });
    await flushFrame();
    expect(result.current.scale).toBeCloseTo(0.9775);
  });

  it('普通纵向和横向滚轮仍使用原生阅读滚动，不缩放或重绘 PDF', async () => {
    const { result, viewport } = await setup();
    expect(wheel(viewport, { deltaY: 100 }).defaultPrevented).toBe(false);
    expect(wheel(viewport, { deltaX: 100 }).defaultPrevented).toBe(false);
    await flushFrame();
    expect(result.current.scale).toBe(1);
    expect(renders).toHaveLength(1);
  });

  it('同一帧的缩放增量合并，普通滚动不混入缩放', async () => {
    const { result, viewport } = await setup();
    wheel(viewport, { deltaY: -100, ctrlKey: true });
    wheel(viewport, { deltaY: 900 });
    wheel(viewport, { deltaY: -100, ctrlKey: true });
    await flushFrame();
    expect(result.current.scale).toBeCloseTo(1.3);
    expect(renders).toHaveLength(1);
  });

  it.each([
    [1, -3, 1.072],
    [2, -1, 1.75],
  ])('滚轮 deltaMode=%i 按行或视口高度换算缩放增量', async (deltaMode, deltaY, expected) => {
    const { result, viewport } = await setup();
    wheel(viewport, { deltaMode, deltaY, ctrlKey: true });
    await flushFrame();
    expect(result.current.scale).toBeCloseTo(expected);
  });

  it('滚轮缩放遵守按钮的 50%–300% 边界，边界处仍阻止浏览器缩放', async () => {
    const { result, viewport } = await setup();
    wheel(viewport, { deltaY: -100000, ctrlKey: true });
    await flushFrame();
    expect(result.current.scale).toBe(3);
    expect(wheel(viewport, { deltaY: -100, ctrlKey: true }).defaultPrevented).toBe(true);
    await flushFrame();
    expect(result.current.scale).toBe(3);
    wheel(viewport, { deltaY: 100000, metaKey: true });
    await flushFrame();
    expect(result.current.scale).toBe(0.5);
    expect(wheel(viewport, { deltaY: 100, metaKey: true }).defaultPrevented).toBe(true);
    await flushFrame();
    expect(result.current.scale).toBe(0.5);
    act(() => result.current.zoomIn());
    expect(result.current.scale).toBe(0.75);
    act(() => result.current.reset());
    expect(result.current.scale).toBe(1);
  });

  it('识别框上的滚轮事件冒泡后仍可缩放 PDF', async () => {
    const { result, viewport } = await setup();
    const block = document.createElement('button');
    viewport.appendChild(block);
    expect(wheel(block, { deltaY: -100, ctrlKey: true }).defaultPrevented).toBe(true);
    await flushFrame();
    expect(result.current.scale).toBeCloseTo(1.15);
  });

  it('更换或卸载视口时移除监听并取消未提交的缩放帧', async () => {
    const { result, viewport, unmount } = await setup();
    const nextViewport = document.createElement('div');
    wheel(viewport, { deltaY: -100, ctrlKey: true });
    act(() => result.current.setViewport(nextViewport));
    await flushFrame();
    expect(result.current.scale).toBe(1);
    expect(wheel(viewport, { deltaY: -100, ctrlKey: true }).defaultPrevented).toBe(false);
    wheel(nextViewport, { deltaY: -100, ctrlKey: true });
    await flushFrame();
    expect(result.current.scale).toBeCloseTo(1.15);
    wheel(nextViewport, { deltaY: -100, ctrlKey: true });
    unmount();
    expect(wheel(nextViewport, { deltaY: -100, ctrlKey: true }).defaultPrevented).toBe(false);
    await flushFrame();
    expect(result.current.scale).toBeCloseTo(1.15);
  });

  it('PDF 尚未加载时不拦截滚轮或改变缩放', async () => {
    mocks.load.mockReturnValue({
      promise: new Promise(() => {}),
      destroy: vi.fn().mockResolvedValue(undefined),
    });
    const { result } = renderHook(() => usePdfPreview('/pending.pdf'));
    const viewport = document.createElement('div');
    act(() => result.current.setViewport(viewport));
    expect(wheel(viewport, { deltaY: -100, ctrlKey: true }).defaultPrevented).toBe(false);
    await flushFrame();
    expect(result.current.scale).toBe(1);
  });

  it('页面尺寸读取失败时结束加载并提供可恢复错误', async () => {
    mocks.load.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockRejectedValue(new Error('page unavailable')),
      }),
      destroy: vi.fn().mockResolvedValue(undefined),
    });
    const hook = renderHook(() => usePdfPreview('/invalid-page.pdf'));
    const viewport = document.createElement('div');
    Object.defineProperty(viewport, 'clientWidth', { value: 632 });
    act(() => hook.result.current.setViewport(viewport));
    await waitFor(() => expect(hook.result.current.error).toBe('documentPdfFailed'));
    expect(hook.result.current.rendering).toBe(false);
    hook.unmount();
  });
});
