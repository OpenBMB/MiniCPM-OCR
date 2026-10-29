import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useImageParseTaskNavigation } from '../useImageParseTaskNavigation';
import type { ImageParseMode } from '@/api/map/imageParseSdk';

const attachment = {
  id: 'file-a',
  kind: 'image' as const,
  name: 'a.png',
  mime: 'image/png',
  size: 12,
  dataUrl: 'data:image/png;base64,AAA',
};
const snapshot = { attachment, mode: 'standard' as const, markdown: '全文', layout: [] };

describe('工作台任务结果保留', () => {
  it('切换回原任务恢复其结果和草稿身份', () => {
    const restore = vi.fn().mockReturnValue(true);
    const setResultRevision = vi.fn();
    const selectMode = vi.fn();
    const { result, rerender } = renderHook(
      ({ mode, current }) =>
        useImageParseTaskNavigation({
          scope: 'project-a',
          attachment,
          mode,
          snapshot: current,
          restore,
          selectMode,
          resultRevision: 7,
          setResultRevision,
          finished: true,
        }),
      {
        initialProps: {
          mode: 'standard' as ImageParseMode,
          current: snapshot as typeof snapshot | null,
        },
      },
    );
    act(() => result.current('kie'));
    expect(selectMode).toHaveBeenCalledWith('kie');
    rerender({ mode: 'kie', current: null });
    act(() => result.current('standard'));
    expect(restore).toHaveBeenCalledWith(snapshot, { finished: true });
    expect(setResultRevision).toHaveBeenCalledWith(7);
  });
});
