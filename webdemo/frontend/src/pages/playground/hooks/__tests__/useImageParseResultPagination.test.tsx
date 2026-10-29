import type { UIEvent } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useImageParseScrollSync } from '../useImageParseScrollSync';

const pageKey = (page = 1) => `document:${page}`;

function viewport(page: number, height = 1000) {
  const root = document.createElement('section');
  root.dataset.ocrResultTab = 'preview';
  const node = document.createElement('div');
  node.dataset.ocrResultScroll = '';
  Object.defineProperties(node, {
    scrollHeight: { value: height },
    clientHeight: { value: 200 },
  });
  root.append(node);
  document.body.append(root);
  return { root, node, page };
}

function setup(page = 2, pages = 4, height = 1000, linked = true) {
  const setPage = vi.fn();
  const hook = renderHook(
    ({ page, linked, markdown }) =>
      useImageParseScrollSync(linked, pageKey(page), [], {
        pdf: { page, pages, setPage },
        resultKeyForPage: pageKey,
        markdown,
      }),
    { initialProps: { page, linked, markdown: 'body' } },
  );
  let view = viewport(page, height);
  const mount = () =>
    act(() => {
      hook.result.current.resultRef(view.node);
      hook.result.current.resultPaneRef?.(view.root);
    });
  mount();
  return {
    ...hook,
    setPage,
    get view() {
      return view;
    },
    enter(next: number, nextHeight = 1000) {
      act(() => {
        hook.result.current.resultRef(null);
        hook.result.current.resultPaneRef?.(null);
      });
      view.root.remove();
      hook.rerender({ page: next, linked, markdown: 'body' });
      view = viewport(next, nextHeight);
      mount();
      act(() => vi.advanceTimersByTime(40));
    },
  };
}

function wheel(node: HTMLElement, deltaY: number, options: WheelEventInit = {}) {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, ...options });
  act(() => node.dispatchEvent(event));
  return event;
}

describe('PDF result boundary pagination', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('should retain native scrolling inside a page and enter the next page at the bottom', () => {
    const hook = setup();
    hook.view.node.scrollTop = 400;
    expect(wheel(hook.view.node, 120).defaultPrevented).toBe(false);
    expect(hook.setPage).not.toHaveBeenCalled();

    hook.view.node.scrollTop = 800;
    expect(wheel(hook.view.node, 120).defaultPrevented).toBe(true);
    expect(hook.setPage).toHaveBeenCalledExactlyOnceWith(3);
    hook.enter(3);
    expect(hook.view.node.scrollTop).toBe(0);
  });

  it('should enter the previous page at its bottom without skipping pages during a wheel burst', () => {
    const hook = setup();
    wheel(hook.view.node, -120);
    expect(hook.setPage).toHaveBeenCalledExactlyOnceWith(1);
    wheel(hook.view.node, -120);
    hook.enter(1, 1400);
    expect(hook.view.node.scrollTop).toBe(1200);
    expect(hook.setPage).toHaveBeenCalledOnce();
  });

  it('should let short pages turn while suppressing repeated inertial navigation', () => {
    const hook = setup(1, 4, 100);
    wheel(hook.view.node, 120);
    expect(hook.setPage).toHaveBeenCalledExactlyOnceWith(2);
    hook.enter(2, 100);
    wheel(hook.view.node, 120);
    expect(hook.setPage).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(400));
    wheel(hook.view.node, 120);
    expect(hook.setPage).toHaveBeenLastCalledWith(3);
    expect(hook.setPage).toHaveBeenCalledTimes(2);
  });

  it('should not wrap the first or last page or turn pages for programmatic scrolling', () => {
    const first = setup(1);
    wheel(first.view.node, -120);
    expect(first.setPage).not.toHaveBeenCalled();
    first.unmount();
    const last = setup(4);
    last.view.node.scrollTop = 800;
    act(() => {
      last.result.current.onResultScroll({ currentTarget: last.view.node } as UIEvent<HTMLDivElement>);
    });
    wheel(last.view.node, 120);
    expect(last.setPage).not.toHaveBeenCalled();
  });

  it('should turn pages independently of linking but leave source editing and zoom gestures alone', () => {
    const hook = setup(2, 4, 100, false);
    wheel(hook.view.node, 120, { ctrlKey: true });
    wheel(hook.view.node, 120, { metaKey: true });
    wheel(hook.view.node, 20, { deltaX: 100 });
    hook.view.root.dataset.ocrResultTab = 'source';
    wheel(hook.view.node, 120);
    hook.view.root.dataset.ocrResultTab = 'preview';
    const editor = document.createElement('div');
    editor.dataset.visualEditing = 'true';
    hook.view.node.append(editor);
    wheel(editor, 120);
    expect(hook.setPage).not.toHaveBeenCalled();
    editor.remove();
    wheel(hook.view.node, 120);
    expect(hook.setPage).toHaveBeenCalledExactlyOnceWith(3);
  });

  it('should let empty, pending or failed pages turn without requiring a preview viewport', () => {
    const hook = setup();
    act(() => hook.result.current.resultRef(null));
    hook.view.node.remove();
    wheel(hook.view.root, 120);
    expect(hook.setPage).toHaveBeenCalledExactlyOnceWith(3);
  });

  it('should align backward entry with the previous PDF page bottom and suppress its scroll echo', () => {
    const hook = setup(3);
    const origin = document.createElement('div');
    origin.dataset.pdfViewport = '';
    origin.dataset.pdfCurrentPage = '3';
    Object.defineProperties(origin, {
      scrollHeight: { value: 3400 },
      clientHeight: { value: 200 },
    });
    for (const pageNumber of [1, 2, 3, 4]) {
      const page = document.createElement('div');
      page.dataset.pdfPage = String(pageNumber);
      page.getBoundingClientRect = () =>
        new DOMRect(0, (pageNumber - 1) * 816 - origin.scrollTop, 400, 800);
      origin.append(page);
    }
    act(() => hook.result.current.originProps.originScrollRef(origin));
    wheel(hook.view.node, -120);
    origin.dataset.pdfCurrentPage = '2';
    hook.enter(2);
    expect(hook.view.node.scrollTop).toBe(800);
    const progress = hook.result.current.originProps.scrollProgress!;
    expect(progress).toBeCloseTo((816 + 800 - 200) / 3200);
    act(() => hook.result.current.originProps.onScrollProgress(progress, true));
    expect(hook.view.node.scrollTop).toBe(800);
    expect(hook.result.current.originProps.scrollProgress).toBeUndefined();
  });
});
