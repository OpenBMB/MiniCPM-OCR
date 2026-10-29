import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useImageParseFieldDraft } from '../useImageParseFieldDraft';

describe('字段配置草稿', () => {
  it('配置修改不改写已提交字段，返回结果可丢弃配置草稿', () => {
    const applied = ['发票号码'];
    const { result } = renderHook(() => useImageParseFieldDraft(applied, 'file-a'));
    act(() => result.current.setFields(['合同编号']));
    expect(result.current.fields).toEqual(['合同编号']);
    expect(applied).toEqual(['发票号码']);
    act(() => result.current.reset());
    expect(result.current.fields).toEqual(applied);
  });

  it('同一文件切换任务保留配置，新文件不继承旧配置', () => {
    const { result, rerender } = renderHook(
      ({ fields, key }) => useImageParseFieldDraft(fields, key),
      { initialProps: { fields: ['发票号码'], key: 'file-a' } },
    );
    act(() => result.current.setFields(['合同编号']));
    rerender({ fields: [], key: 'file-a' });
    rerender({ fields: ['发票号码'], key: 'file-a' });
    expect(result.current.fields).toEqual(['合同编号']);
    rerender({ fields: [], key: 'file-b' });
    expect(result.current.fields).toEqual([]);
  });
});
