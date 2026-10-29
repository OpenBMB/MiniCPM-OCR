import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TooltipProvider } from '@map/ui';
import { setApplicationLocale } from '@/i18n';
import { BlankLayout } from './BlankLayout';

describe('BlankLayout', () => {
  beforeEach(async () => {
    await setApplicationLocale('zh-CN');
  });

  afterEach(async () => {
    await setApplicationLocale('zh-CN');
  });

  it('不在体验中心额外渲染固定定位的语言切换器', () => {
    render(
      <TooltipProvider>
        <MemoryRouter initialEntries={['/playground']}>
          <Routes>
            <Route element={<BlankLayout />}>
              <Route path="/playground" element={<main>体验中心</main>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </TooltipProvider>,
    );

    expect(screen.getByRole('main', { name: '' })).toHaveTextContent('体验中心');
    expect(screen.queryByRole('button', { name: '切换为英文' })).not.toBeInTheDocument();
  });

  it('不在协议页面额外渲染固定定位的语言切换器', () => {
    render(
      <TooltipProvider>
        <MemoryRouter initialEntries={['/legal/terms']}>
          <Routes>
            <Route element={<BlankLayout />}>
              <Route path="/legal/:slug" element={<main>用户协议</main>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </TooltipProvider>,
    );

    expect(screen.getByRole('main', { name: '' })).toHaveTextContent('用户协议');
    expect(screen.queryByRole('button', { name: '切换为英文' })).not.toBeInTheDocument();
  });
});
