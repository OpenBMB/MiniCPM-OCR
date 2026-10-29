import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PhoneBindingGuard } from './phone-binding-guard';

const { meMock } = vi.hoisted(() => ({ meMock: vi.fn() }));

vi.mock('@/api/map', () => ({
  mapAuthApi: { me: meMock },
  mapKeys: { me: () => ['map', 'me'] },
}));

function renderGuard(initialEntry: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path="/bind-phone"
            element={
              <PhoneBindingGuard>
                <div data-testid="bind-phone">绑定手机号</div>
              </PhoneBindingGuard>
            }
          />
          <Route
            path="*"
            element={
              <PhoneBindingGuard>
                <div data-testid="protected">业务页面</div>
              </PhoneBindingGuard>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PhoneBindingGuard', () => {
  it('邮箱账号未绑定手机号时重定向绑定页', async () => {
    meMock.mockResolvedValue({
      email: 'user@example.com',
      phone: '',
      phone_binding_required: true,
    });

    renderGuard('/models');

    await waitFor(() => {
      expect(screen.getByTestId('bind-phone')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
  });

  it('绑定页允许未绑定手机号账号进入', async () => {
    meMock.mockResolvedValue({
      email: 'user@example.com',
      phone: '',
      phone_binding_required: true,
    });

    renderGuard('/bind-phone');

    expect(screen.getByTestId('bind-phone')).toBeInTheDocument();
  });

  it('已绑定手机号账号正常进入业务页面', async () => {
    meMock.mockResolvedValue({
      email: 'user@example.com',
      phone: '13800138000',
      phone_binding_required: true,
    });

    renderGuard('/models');

    await waitFor(() => {
      expect(screen.getByTestId('protected')).toBeInTheDocument();
    });
  });
});
