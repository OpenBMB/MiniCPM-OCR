import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useImageParseSelection } from '../useImageParseSelection';

describe('useImageParseSelection', () => {
  it('邻页选择绑定目标结果身份，切页后保留点击定位且不选中其他页同名块', () => {
    const { result, rerender } = renderHook(({ key }) => useImageParseSelection(key, true, true), {
      initialProps: { key: 'pdf:1:page-2' },
    });
    act(() => result.current.select('ocr-0', 'origin', 'pdf:1:page-1'));
    expect(result.current.selectedId).toBeUndefined();
    rerender({ key: 'pdf:1:page-1' });
    expect(result.current.selectedId).toBe('ocr-0');
    expect(result.current.resultFocus).toBe(1);
    expect(result.current.originFocus).toBeUndefined();
    rerender({ key: 'pdf:2:page-1' });
    expect(result.current.selectedId).toBeUndefined();
  });
});
