import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from 'i18next';
import '@/i18n';
import { Sidebar } from './Sidebar';

vi.mock('@/api/map', () => ({
  useFeatureAccessQuery: () => ({ data: { voice_clone: true } }),
  useRewardsQuery: () => ({
    data: {
      daily_checkin_points: '0',
      daily_checkin_enabled: false,
      claimed_today: false,
    },
  }),
}));

describe('门户侧栏', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN');
  });

  it('将 API 文档放在底部账号菜单，并从主菜单移除', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar collapsed={false} onToggle={vi.fn()} />
      </MemoryRouter>,
    );

    expect(
      within(screen.getByRole('navigation', { name: '主菜单' })).queryByRole('button', {
        name: 'API 文档',
      }),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: '账号菜单' })).getByRole('button', {
        name: 'API 文档',
      }),
    ).toBeInTheDocument();
  });

  it('为 API 文档入口渲染书本图标，而不是默认圆环占位图标', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar collapsed={false} onToggle={vi.fn()} />
      </MemoryRouter>,
    );

    const docs = screen.getByRole('button', { name: 'API 文档' });

    expect(docs.querySelector('svg circle')).not.toBeInTheDocument();
    expect(docs.querySelectorAll('svg path')).toHaveLength(2);
  });

  it('将 API 文档从主导航移至侧栏底部的个人设置入口上方', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar collapsed={false} onToggle={vi.fn()} />
      </MemoryRouter>,
    );

    const navigation = screen.getByRole('navigation', { name: '主菜单' });
    const docs = screen.getByRole('button', { name: 'API 文档' });
    const profile = screen.getByRole('button', { name: '个人设置' });

    expect(within(navigation).queryByRole('button', { name: 'API 文档' })).not.toBeInTheDocument();
    expect(docs.compareDocumentPosition(profile) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });
});
