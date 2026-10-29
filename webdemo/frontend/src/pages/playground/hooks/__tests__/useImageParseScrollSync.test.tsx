import type { UIEvent } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useImageParseScrollSync } from '../useImageParseScrollSync';
import { IMAGE_PARSE_SAMPLE_BLOCKS } from '../../utils/__tests__/imageParseSampleFixtures';

function resultViewport(height = 1000, visible = 200) {
  const node = document.createElement('div');
  Object.defineProperties(node, {
    scrollHeight: { configurable: true, value: height },
    clientHeight: { configurable: true, value: visible },
  });
  return node;
}

function scrollEvent(node: HTMLDivElement) {
  return { currentTarget: node } as UIEvent<HTMLDivElement>;
}

describe('useImageParseScrollSync', () => {
  it('按同一块的真实渲染锚点对齐左右栏，而不是使用整栏比例', () => {
    const origin = resultViewport(1000, 200);
    const raster = document.createElement('span');
    raster.dataset.imageRaster = '';
    origin.append(raster);
    raster.getBoundingClientRect = () => new DOMRect(0, -400, 400, 1000);
    const node = resultViewport();
    const paragraph = document.createElement('p');
    paragraph.dataset.ocrLinkedIds = '["target"]';
    node.append(paragraph);
    paragraph.getBoundingClientRect = () => new DOMRect(0, 200 - node.scrollTop, 400, 80);
    const blocks = [{ ...IMAGE_PARSE_SAMPLE_BLOCKS[2], id: 'target', y: 0.4, h: 0.08 }];
    const { result } = renderHook(() => useImageParseScrollSync(true, 'anchors', blocks));
    act(() => {
      result.current.resultRef(node);
      result.current.originProps.originScrollRef?.(origin);
      result.current.originProps.onScrollProgress(0.5);
    });
    expect(node.scrollTop).toBe(200);
    act(() => result.current.onResultScroll(scrollEvent(node)));
    expect(result.current.originProps.scrollProgress).toBeUndefined();
    node.scrollTop = 200;
    act(() => result.current.onResultScroll(scrollEvent(node)));
    expect(result.current.originProps.scrollProgress).toBeCloseTo(0.5);
  });
  it('should tolerate an absent result identity before any scroll request exists', () => {
    const { result } = renderHook(() =>
      useImageParseScrollSync(true, undefined as unknown as string),
    );
    expect(result.current.originProps.scrollProgress).toBeUndefined();
  });

  it('should clear an old origin request when the user takes over or toggles linking', () => {
    const { result, rerender } = renderHook(({ linked }) => useImageParseScrollSync(linked, ''), {
      initialProps: { linked: true },
    });
    const node = resultViewport();
    act(() => result.current.resultRef(node));
    node.scrollTop = 400;
    act(() => result.current.onResultScroll(scrollEvent(node)));
    expect(result.current.originProps.scrollProgress).toBe(0.5);
    act(() => result.current.originProps.onScrollProgress(0.75));
    expect(result.current.originProps.scrollProgress).toBeUndefined();
    expect(node.scrollTop).toBe(600);
    act(() => result.current.onResultScroll(scrollEvent(node)));
    node.scrollTop = 200;
    act(() => result.current.onResultScroll(scrollEvent(node)));
    rerender({ linked: false });
    rerender({ linked: true });
    expect(result.current.originProps.scrollProgress).toBeUndefined();
  });

  it('should map origin progress to result scroll without echoing the programmatic scroll', () => {
    const { result } = renderHook(() => useImageParseScrollSync(true, 'first'));
    const node = resultViewport();
    act(() => result.current.resultRef(node));
    act(() => result.current.originProps.onScrollProgress(0.5));
    expect(node.scrollTop).toBe(400);
    act(() => result.current.onResultScroll(scrollEvent(node)));
    expect(result.current.originProps.scrollProgress).toBeUndefined();
    node.scrollTop = 600;
    act(() => result.current.onResultScroll(scrollEvent(node)));
    expect(result.current.originProps.scrollProgress).toBe(0.75);
  });

  it('should not map origin when a result block focus settles at a different scroll offset', () => {
    const { result } = renderHook(() => useImageParseScrollSync(true, 'first'));
    const node = resultViewport();
    act(() => result.current.resultRef(node));

    act(() => {
      result.current.scrollResultTo(500);
      node.scrollTop = 450;
      result.current.onResultScroll(scrollEvent(node));
    });

    expect(result.current.originProps.scrollProgress).toBeUndefined();
  });

  it('should map result progress to origin without writing back its acknowledgment', () => {
    const { result } = renderHook(() => useImageParseScrollSync(true, 'first'));
    const node = resultViewport();
    act(() => result.current.resultRef(node));
    node.scrollTop = 200;
    act(() => result.current.onResultScroll(scrollEvent(node)));
    expect(result.current.originProps.scrollProgress).toBe(0.25);
    // 高度变化后的确认不能反向覆盖结果栏的位置。
    Object.defineProperty(node, 'scrollHeight', { value: 2000 });
    act(() => result.current.originProps.onScrollProgress(0.25));
    expect(node.scrollTop).toBe(200);
    expect(result.current.originProps.scrollProgress).toBeUndefined();
    act(() => result.current.originProps.onScrollProgress(0.5));
    expect(node.scrollTop).toBe(900);
  });

  it('should do no synchronization while disabled and clear requests across results', () => {
    const { result, rerender } = renderHook(
      ({ linked, key }) => useImageParseScrollSync(linked, key),
      { initialProps: { linked: false, key: 'first' } },
    );
    const node = resultViewport();
    act(() => result.current.resultRef(node));
    act(() => result.current.originProps.onScrollProgress(0.5));
    expect(node.scrollTop).toBe(0);
    node.scrollTop = 200;
    act(() => result.current.onResultScroll(scrollEvent(node)));
    expect(result.current.originProps.scrollProgress).toBeUndefined();
    rerender({ linked: true, key: 'first' });
    act(() => result.current.onResultScroll(scrollEvent(node)));
    expect(result.current.originProps.scrollProgress).toBe(0.25);
    rerender({ linked: true, key: 'second' });
    expect(result.current.originProps.scrollProgress).toBeUndefined();
    rerender({ linked: false, key: 'second' });
    expect(result.current.originProps.scrollProgress).toBeUndefined();
  });

  it('无滚动空间的结果面板不反向请求原文回到顶部', () => {
    const { result } = renderHook(() => useImageParseScrollSync(true, 'first'));
    act(() => result.current.originProps.onScrollProgress(0.5));
    const node = resultViewport(100, 200);
    act(() => result.current.resultRef(node));
    act(() => result.current.originProps.onScrollProgress(Number.NaN));
    expect(node.scrollTop).toBe(0);
    act(() => result.current.onResultScroll(scrollEvent(node)));
    expect(result.current.originProps.scrollProgress).toBeUndefined();
    act(() => result.current.resultRef(null));
    act(() => result.current.originProps.onScrollProgress(2));
  });

  it('PDF 第二页结果反复滚到首尾仍停留在第二页且不回写确认', () => {
    const origin = resultViewport(2600, 200);
    origin.dataset.pdfViewport = '';
    origin.dataset.pdfCurrentPage = '2';
    const page = document.createElement('div');
    page.dataset.pdfPage = '2';
    page.getBoundingClientRect = () => new DOMRect(0, 816 - origin.scrollTop, 400, 800);
    origin.append(page);
    const node = resultViewport(1200, 200);
    const { result } = renderHook(() => useImageParseScrollSync(true, 'pdf:2'));
    act(() => {
      result.current.resultRef(node);
      result.current.originProps.originScrollRef(origin);
    });
    for (const top of [1000, 0, 1000, 0]) {
      node.scrollTop = top;
      act(() => result.current.onResultScroll(scrollEvent(node)));
      const progress = result.current.originProps.scrollProgress!;
      expect(progress).toBeCloseTo((top ? 1416 : 816) / 2400);
      origin.scrollTop = progress * 2400;
      act(() => result.current.originProps.onScrollProgress(progress, true));
      expect(node.scrollTop).toBe(top);
      expect(result.current.originProps.scrollProgress).toBeUndefined();
    }
  });

  it('should accept genuine user input before a pending sync acknowledgment', () => {
    const { result } = renderHook(() => useImageParseScrollSync(true, 'first'));
    const node = resultViewport();
    act(() => result.current.resultRef(node));
    act(() => result.current.originProps.onScrollProgress(0.8));
    node.scrollTop = 200;
    act(() => result.current.onResultScroll(scrollEvent(node)));
    expect(result.current.originProps.scrollProgress).toBe(0.25);
    act(() => result.current.originProps.onScrollProgress(0.4));
    expect(node.scrollTop).toBe(320);
  });
});
