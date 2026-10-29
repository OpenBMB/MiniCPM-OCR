import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthGuard } from '../router/guard';

// 守卫以 getToken()(localStorage['map_token']) 是否有值判断登录态，mock 之以控制场景。
const { getTokenMock } = vi.hoisted(() => ({ getTokenMock: vi.fn() }));
vi.mock('@/api/map', () => ({
  getToken: getTokenMock,
}));

vi.mock('../router/constants', () => ({
  whiteList: ['/login'],
}));

function renderWithRouter(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/login" element={<div data-testid="login-page">登录页</div>} />
        <Route
          path="*"
          element={
            <AuthGuard>
              <div data-testid="protected">受保护内容</div>
            </AuthGuard>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getTokenMock.mockReset();
  getTokenMock.mockReturnValue('');
});

describe('AuthGuard', () => {
  it('无 token 时应重定向到 /login', () => {
    renderWithRouter('/');
    expect(screen.getByTestId('login-page')).toBeInTheDocument();
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
  });

  it('有 token 时应渲染子组件', () => {
    getTokenMock.mockReturnValue('valid_token');
    renderWithRouter('/');
    expect(screen.getByTestId('protected')).toBeInTheDocument();
  });

  it('白名单路由无需 token 也应渲染', () => {
    renderWithRouter('/login');
    expect(screen.getByTestId('login-page')).toBeInTheDocument();
  });
});
