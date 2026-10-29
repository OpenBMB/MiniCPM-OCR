/**
 * 校对草稿单测：改稿后进入 dirty、还原回到结果、新结果覆盖旧草稿。
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useImageParseDraft } from '../useImageParseDraft';

describe('useImageParseDraft', () => {
  it('starts clean and mirrors the parse result', () => {
    const { result } = renderHook(() => useImageParseDraft('原始'));
    expect(result.current.value).toBe('原始');
    expect(result.current.dirty).toBe(false);
  });

  it('marks the draft dirty once edited and clean again after reset', () => {
    const { result } = renderHook(() => useImageParseDraft('原始'));
    act(() => result.current.setValue('改过'));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.reset());
    expect(result.current.value).toBe('原始');
    expect(result.current.dirty).toBe(false);
  });

  it('系统重生成可还原，但不标记为人工编辑', () => {
    const { result } = renderHook(() => useImageParseDraft('原始'));
    act(() => result.current.setValue('系统优化', undefined, 'model'));
    expect(result.current.dirty).toBe(true);
    expect(result.current.manuallyEdited).toBe(false);
    act(() => result.current.setValue('人工修改'));
    expect(result.current.manuallyEdited).toBe(true);
    act(() => result.current.setValue('人工修改后继续优化', undefined, 'model'));
    expect(result.current.manuallyEdited).toBe(true);
    act(() => result.current.reset());
    expect(result.current.manuallyEdited).toBe(false);
  });

  it('follows a new parse result instead of keeping a stale draft', () => {
    // 重新解析或换图后旧草稿已无意义，留着会让用户以为改动仍对应当前这张图。
    const { result, rerender } = renderHook(({ md }) => useImageParseDraft(md), {
      initialProps: { md: '第一版' },
    });
    act(() => result.current.setValue('改过'));
    rerender({ md: '第二版' });
    expect(result.current.value).toBe('第二版');
    expect(result.current.dirty).toBe(false);
  });

  it('does not revive edits when another document or run produces identical text', () => {
    const { result, rerender } = renderHook(({ key }) => useImageParseDraft('相同识别文本', key), {
      initialProps: { key: 'first:1' },
    });
    act(() => result.current.setValue('上一个文档的校对'));
    rerender({ key: 'second:1' });
    expect(result.current.value).toBe('相同识别文本');
    expect(result.current.dirty).toBe(false);
    act(() => result.current.setValue('上一轮的校对'));
    rerender({ key: 'second:2' });
    expect(result.current.value).toBe('相同识别文本');
    expect(result.current.dirty).toBe(false);
  });

  it('连续预览与当前页共用草稿，离开页面后仍保留修改及范围', () => {
    const ranges = new Map([['same-id', { start: 0, end: 2 }]]);
    const { result, rerender } = renderHook(
      ({ page }) => useImageParseDraft(`第${page}页`, `pdf:${page}`, ranges),
      { initialProps: { page: 1 } },
    );
    act(() => result.current.forResult!('第2页', 'pdf:2', ranges).setValue('第二页已校对'));
    expect(result.current.value).toBe('第1页');
    rerender({ page: 2 });
    expect(result.current.value).toBe('第二页已校对');
    expect(result.current.dirty).toBe(true);
    expect(result.current.forResult!('第2页', 'pdf:2', ranges).ranges).toBe(result.current.ranges);
    act(() => result.current.reset());
    expect(result.current.forResult!('第2页', 'pdf:2', ranges).value).toBe('第2页');
  });
});
