import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAutoScroll } from './useAutoScroll';

interface AutoScrollHarnessProps {
  updateKey: string;
  turnKey: string;
}

/** Mount the auto-scroll hook, so tests can use a real ref and scroll events. */
function AutoScrollHarness({ updateKey, turnKey }: AutoScrollHarnessProps) {
  const { scrollRef, contentRef, onScroll, onWheel, onTouchMove, onKeyDown, onPointerDown } =
    useAutoScroll(updateKey, turnKey);

  return (
    <div
      ref={scrollRef}
      data-testid="scroll-container"
      onScroll={onScroll}
      onWheel={onWheel}
      onTouchMove={onTouchMove}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
    >
      <div ref={contentRef} data-testid="scroll-content" />
    </div>
  );
}

interface ScrollMetrics {
  scrollHeight: number;
  clientHeight: number;
}

/** Provide a controllable size for a jsdom scroll container. */
function setScrollMetrics(element: HTMLElement, metrics: ScrollMetrics) {
  Object.defineProperties(element, {
    scrollHeight: {
      configurable: true,
      get: () => metrics.scrollHeight,
    },
    clientHeight: {
      configurable: true,
      get: () => metrics.clientHeight,
    },
  });
}

/** Trigger one content-size change. */
function notifyResize(callback: ResizeObserverCallback | undefined, target: Element) {
  callback?.([{ target } as unknown as ResizeObserverEntry], {} as ResizeObserver);
}

describe('useAutoScroll', () => {
  let resizeCallback: ResizeObserverCallback | undefined;

  beforeEach(() => {
    resizeCallback = undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserverMock {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = callback;
        }

        observe() {}

        unobserve() {}

        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('开始新一轮对话时即使此前上滚也会直接滚到底部', () => {
    const metrics = { scrollHeight: 1_000, clientHeight: 300 };
    const { rerender } = render(<AutoScrollHarness updateKey="initial" turnKey="turn-1" />);
    const scroller = screen.getByTestId('scroll-container');
    setScrollMetrics(scroller, metrics);

    scroller.scrollTop = 100;
    fireEvent.scroll(scroller);
    metrics.scrollHeight = 1_200;

    rerender(<AutoScrollHarness updateKey="initial" turnKey="turn-2" />);

    expect(scroller.scrollTop).toBe(1_200);
  });

  it('跟随状态下内容布局增高后继续贴住底部', () => {
    const metrics = { scrollHeight: 800, clientHeight: 300 };
    const { rerender } = render(<AutoScrollHarness updateKey="initial" turnKey="turn-1" />);
    const scroller = screen.getByTestId('scroll-container');
    const content = screen.getByTestId('scroll-content');
    setScrollMetrics(scroller, metrics);

    rerender(<AutoScrollHarness updateKey="content-updated" turnKey="turn-1" />);
    expect(scroller.scrollTop).toBe(800);

    metrics.scrollHeight = 960;
    notifyResize(resizeCallback, content);

    expect(resizeCallback).toBeTypeOf('function');
    expect(scroller.scrollTop).toBe(960);
  });

  it('内容增高引发的非用户 scroll 不会中断自动跟随', () => {
    const metrics = { scrollHeight: 800, clientHeight: 300 };
    const { rerender } = render(<AutoScrollHarness updateKey="initial" turnKey="turn-1" />);
    const scroller = screen.getByTestId('scroll-container');
    const content = screen.getByTestId('scroll-content');
    setScrollMetrics(scroller, metrics);

    rerender(<AutoScrollHarness updateKey="content-updated" turnKey="turn-1" />);
    scroller.scrollTop = 500;

    metrics.scrollHeight = 1_000;
    fireEvent.scroll(scroller);
    notifyResize(resizeCallback, content);

    expect(scroller.scrollTop).toBe(1_000);
  });

  it('用户主动上滚后内容增高不会强制拉回底部', () => {
    const metrics = { scrollHeight: 800, clientHeight: 300 };
    const { rerender } = render(<AutoScrollHarness updateKey="initial" turnKey="turn-1" />);
    const scroller = screen.getByTestId('scroll-container');
    const content = screen.getByTestId('scroll-content');
    setScrollMetrics(scroller, metrics);

    rerender(<AutoScrollHarness updateKey="content-updated" turnKey="turn-1" />);
    fireEvent.wheel(scroller, { deltaY: -120 });
    scroller.scrollTop = 120;
    fireEvent.scroll(scroller);

    metrics.scrollHeight = 1_000;
    notifyResize(resizeCallback, content);

    expect(resizeCallback).toBeTypeOf('function');
    expect(scroller.scrollTop).toBe(120);
  });

  it('用户点击引起的高度变化不吸底，被点开的那一行留在原处', () => {
    const metrics = { scrollHeight: 800, clientHeight: 300 };
    const { rerender } = render(<AutoScrollHarness updateKey="initial" turnKey="turn-1" />);
    const scroller = screen.getByTestId('scroll-container');
    const content = screen.getByTestId('scroll-content');
    setScrollMetrics(scroller, metrics);

    rerender(<AutoScrollHarness updateKey="content-updated" turnKey="turn-1" />);
    expect(scroller.scrollTop).toBe(800);

    // Opening one disclosure: the content grows taller, but the viewport must not move, or the row just clicked would be pushed off the top of the screen
    fireEvent.pointerDown(scroller);
    metrics.scrollHeight = 1_400;
    notifyResize(resizeCallback, content);

    expect(scroller.scrollTop).toBe(800);
  });

  it('点击的免疫窗过期后，后续布局变化照常吸底', () => {
    vi.useFakeTimers();
    try {
      const metrics = { scrollHeight: 800, clientHeight: 300 };
      const { rerender } = render(<AutoScrollHarness updateKey="initial" turnKey="turn-1" />);
      const scroller = screen.getByTestId('scroll-container');
      const content = screen.getByTestId('scroll-content');
      setScrollMetrics(scroller, metrics);

      rerender(<AutoScrollHarness updateKey="content-updated" turnKey="turn-1" />);
      fireEvent.pointerDown(scroller);
      // The immunity covers only the deformation from that one click, and does not turn follow off permanently
      vi.advanceTimersByTime(700);

      metrics.scrollHeight = 1_400;
      notifyResize(resizeCallback, content);

      expect(scroller.scrollTop).toBe(1_400);
    } finally {
      vi.useRealTimers();
    }
  });

  it('一次滚轮手势产生多次 scroll 时持续识别为用户滚动', () => {
    const metrics = { scrollHeight: 800, clientHeight: 300 };
    render(<AutoScrollHarness updateKey="initial" turnKey="turn-1" />);
    const scroller = screen.getByTestId('scroll-container');
    const content = screen.getByTestId('scroll-content');
    setScrollMetrics(scroller, metrics);

    fireEvent.wheel(scroller, { deltaY: -80 });
    scroller.scrollTop = 480;
    fireEvent.scroll(scroller);
    scroller.scrollTop = 260;
    fireEvent.scroll(scroller);

    metrics.scrollHeight = 960;
    notifyResize(resizeCallback, content);

    expect(scroller.scrollTop).toBe(260);
  });
});
