import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from 'i18next';
import { TooltipProvider } from '@map/ui';
import '@/i18n';
import { Header } from './Header';

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
}));

vi.mock('@/api/map', () => ({
  mapAuthApi: { me: mocks.me },
  mapKeys: { me: () => ['me'] },
  clearToken: vi.fn(),
  getToken: () => 'token',
}));

function renderHeader() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <TooltipProvider>
          <Header isMobile={false} onMenuToggle={vi.fn()} />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('门户顶栏用户菜单', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN');
    mocks.me.mockResolvedValue({ id: 'user-1', platform_role: 'user' });
  });

  it('提供个人设置入口并跳转个人设置页', async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(await screen.findByRole('button', { name: '打开个人菜单' }));

    expect(await screen.findByRole('link', { name: '个人设置' })).toHaveAttribute(
      'href',
      '/profile',
    );
  });
});
