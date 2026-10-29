import { describe, expect, it, vi } from 'vitest';
import { switchLocaleAndReload } from './locale';

describe('switchLocaleAndReload', () => {
  it('保存目标语言后主动刷新页面', () => {
    const setLocale = vi.fn();
    const reload = vi.fn();

    switchLocaleAndReload('en-US', setLocale, reload);

    expect(setLocale).toHaveBeenCalledWith('en-US');
    expect(reload).toHaveBeenCalledOnce();
    expect(setLocale).toHaveBeenCalledBefore(reload);
  });
});
