import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useImageParseDownloadMenu } from '../useImageParseDownloadMenu';

afterEach(() => {
  document.body.replaceChildren();
});

describe('OCR 下载菜单焦点', () => {
  it('快速下载完成后，延迟关闭回调允许菜单原生回焦', () => {
    const { result, rerender } = renderHook(
      ({ downloading }) => useImageParseDownloadMenu(downloading),
      { initialProps: { downloading: true } },
    );
    const trigger = document.createElement('button');
    trigger.disabled = true;
    document.body.append(trigger);
    result.current.triggerRef.current = trigger;
    const delayedClose = result.current.onCloseAutoFocus;

    trigger.disabled = false;
    rerender({ downloading: false });
    const event = new Event('closeAutoFocus', { cancelable: true });
    act(() => delayedClose(event));

    expect(event.defaultPrevented).toBe(false);
  });

  it('下载仍在进行时暂缓回焦，完成后恢复到已启用的按钮', () => {
    const { result, rerender } = renderHook(
      ({ downloading }) => useImageParseDownloadMenu(downloading),
      { initialProps: { downloading: true } },
    );
    const trigger = document.createElement('button');
    trigger.disabled = true;
    document.body.append(trigger);
    result.current.triggerRef.current = trigger;
    const event = new Event('closeAutoFocus', { cancelable: true });
    act(() => result.current.onCloseAutoFocus(event));
    expect(event.defaultPrevented).toBe(true);

    trigger.disabled = false;
    rerender({ downloading: false });
    expect(trigger).toHaveFocus();
  });

  it('下载期间用户移动焦点后，完成时不抢占焦点', () => {
    const { result, rerender } = renderHook(
      ({ downloading }) => useImageParseDownloadMenu(downloading),
      { initialProps: { downloading: true } },
    );
    const trigger = document.createElement('button');
    const input = document.createElement('input');
    trigger.disabled = true;
    document.body.append(trigger, input);
    result.current.triggerRef.current = trigger;
    act(() => result.current.onCloseAutoFocus(new Event('closeAutoFocus', { cancelable: true })));
    input.focus();

    trigger.disabled = false;
    rerender({ downloading: false });
    expect(input).toHaveFocus();
  });
});
