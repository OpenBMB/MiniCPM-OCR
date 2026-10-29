import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { usePdfPreviewPages } from '../usePdfPreviewPages';

vi.mock('../../utils/pdfPreview', () => ({
  loadPdfPreview: () => ({
    promise: Promise.resolve({
      numPages: 2,
      getPage: () => Promise.resolve({
        getViewport: () => ({ width: 300, height: 400, rotation: 0 }),
      }),
    }),
    destroy: vi.fn().mockResolvedValue(undefined),
  }),
}));

describe('PDF 连续结果滚动页码', () => {
  it('同步页码可只更新当前页，不把精确滚动位置覆盖为页首', async () => {
    const viewport = document.createElement('div');
    Object.defineProperty(viewport, 'clientWidth', { value: 600 });
    const second = document.createElement('div');
    Object.defineProperty(second, 'offsetTop', { value: 816 });
    const { result, rerender } = renderHook(
      ({ page }) => usePdfPreviewPages('/sync.pdf', page, undefined, false),
      { initialProps: { page: 1 } },
    );
    act(() => {
      result.current.setViewport(viewport);
      result.current.setPageNode(2, second);
    });
    await waitFor(() => expect(result.current.pages).toBe(2));
    viewport.scrollTop = 1050;
    rerender({ page: 2 });
    await waitFor(() => expect(result.current.page).toBe(2));
    expect(viewport.scrollTop).toBe(1050);
  });
});
