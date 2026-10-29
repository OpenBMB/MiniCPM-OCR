import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SiteFooter } from './SiteFooter';

describe('SiteFooter', () => {
  it('can hide filing details while exposing Cookie Settings for the GCP profile', () => {
    document.documentElement.lang = 'en-US';
    render(<SiteFooter showFiling={false} showCookieSettings />);

    expect(screen.queryByText(/ICP Filing No\./)).not.toBeInTheDocument();
    expect(screen.queryByText(/Public Security Filing No\./)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cookie Settings' })).toBeInTheDocument();
  });

  it('emits the shared event used to open the Cookie Settings panel', () => {
    document.documentElement.lang = 'en-US';
    const listener = vi.fn();
    window.addEventListener('map:open-cookie-settings', listener);
    render(<SiteFooter showFiling={false} showCookieSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'Cookie Settings' }));
    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener('map:open-cookie-settings', listener);
  });

  it('keeps filing details and hides Cookie Settings by default for legacy deployments', () => {
    document.documentElement.lang = 'zh-CN';
    render(<SiteFooter />);

    expect(screen.getByText('京ICP备2023004350号-1')).toBeInTheDocument();
    expect(screen.getByText('京公网安备 11010802040079号')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cookie 设置' })).not.toBeInTheDocument();
  });
});
