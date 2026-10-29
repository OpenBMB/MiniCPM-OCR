import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '@map/store';
import { TooltipProvider } from '@map/ui';
import { LocaleSwitcher } from './LocaleSwitcher';

describe('LocaleSwitcher', () => {
  beforeEach(() => {
    useAppStore.getState().setLocale('zh-CN');
    document.documentElement.lang = 'zh-CN';
  });

  it('should switch to English without reloading the page', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <LocaleSwitcher />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole('button', { name: '切换为英文' }));

    expect(useAppStore.getState().locale).toBe('en-US');
    expect(document.documentElement.lang).toBe('en-US');
    expect(await screen.findByRole('button', { name: 'Switch to Chinese' })).toBeVisible();
  });
});
