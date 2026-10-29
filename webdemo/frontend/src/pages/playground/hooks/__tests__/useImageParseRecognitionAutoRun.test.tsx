import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useImageParseRecognitionAutoRun } from '../useImageParseRecognitionAutoRun';

interface Options {
  upright: boolean;
  recognizeSeal: boolean;
  hasResult: boolean;
  identity?: string;
}

function renderAutoRun(initialProps: Options) {
  const onReRun = vi.fn();
  const view = renderHook(
    ({ upright, recognizeSeal, hasResult, identity }: Options) =>
      useImageParseRecognitionAutoRun({
        upright,
        recognizeSeal,
        hasResult,
        identity,
        onReRun,
      }),
    { initialProps },
  );
  return { ...view, onReRun };
}

describe('识别选项自动重跑', () => {
  it('已有结果后切换印章只改变展示，切换旋转才会重跑', () => {
    const { rerender, onReRun } = renderAutoRun({
      upright: true,
      recognizeSeal: true,
      hasResult: true,
    });
    expect(onReRun).not.toHaveBeenCalled();

    rerender({ upright: true, recognizeSeal: false, hasResult: true });
    expect(onReRun).not.toHaveBeenCalled();

    rerender({ upright: false, recognizeSeal: false, hasResult: true });
    expect(onReRun).toHaveBeenCalledOnce();
  });

  it('切换到识别中导致结果暂时失效时仍继续重跑', () => {
    const { rerender, onReRun } = renderAutoRun({
      upright: true,
      recognizeSeal: true,
      hasResult: true,
    });

    rerender({ upright: false, recognizeSeal: true, hasResult: false });
    expect(onReRun).toHaveBeenCalledOnce();
  });

  it('没有结果时不触发，也不沿用上一附件的完成标记', () => {
    const { rerender, onReRun } = renderAutoRun({
      upright: true,
      recognizeSeal: true,
      hasResult: false,
      identity: 'first',
    });

    rerender({ upright: false, recognizeSeal: true, hasResult: false, identity: 'first' });
    expect(onReRun).not.toHaveBeenCalled();

    rerender({ upright: false, recognizeSeal: true, hasResult: false, identity: 'second' });
    rerender({ upright: true, recognizeSeal: true, hasResult: false, identity: 'second' });
    expect(onReRun).not.toHaveBeenCalled();
  });
});
