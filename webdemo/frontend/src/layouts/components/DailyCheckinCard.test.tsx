import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setApplicationLocale } from '@/i18n';
import { DailyCheckinCard } from './DailyCheckinCard';

function renderCard(props: Partial<React.ComponentProps<typeof DailyCheckinCard>> = {}) {
  const defaults: React.ComponentProps<typeof DailyCheckinCard> = {
    collapsed: false,
    dailyPoints: '10',
    enabled: true,
    claimedToday: false,
    onOpenRecharges: vi.fn(),
    ...props,
  };
  render(<DailyCheckinCard {...defaults} />);
  return defaults;
}

describe('DailyCheckinCard', () => {
  it('未领取时展示奖励，并跳转到额度中心领取', () => {
    const props = renderCard();

    expect(screen.getByText('今日权益')).toBeInTheDocument();
    expect(screen.getByText('+10')).toBeInTheDocument();
    expect(screen.queryByText('可领取')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '立即领取 10 积分' }));
    expect(props.onOpenRecharges).toHaveBeenCalledOnce();
  });

  it('已领取时仍可跳转到额度中心查看明细', () => {
    const props = renderCard({ claimedToday: true });

    expect(screen.getByText('明日 00:00 可再领取')).toBeInTheDocument();
    const detailsButton = screen.getByRole('button', { name: '查看额度中心' });
    expect(detailsButton).toHaveTextContent('今日已领取 · 查看记录');
    fireEvent.click(detailsButton);
    expect(props.onOpenRecharges).toHaveBeenCalledOnce();
  });

  it('活动关闭时不渲染入口', () => {
    const { container } = render(
      <DailyCheckinCard
        collapsed={false}
        dailyPoints="10"
        enabled={false}
        claimedToday={false}
        onOpenRecharges={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('收起侧栏时保留前往领取页的图标入口', () => {
    renderCard({ collapsed: true });
    expect(
      screen.getByRole('button', { name: '前往额度中心领取今日 10 积分' }),
    ).toBeInTheDocument();
  });

  it('收起侧栏已领取时仍保留查看记录入口', () => {
    renderCard({ collapsed: true, claimedToday: true });
    expect(screen.getByRole('button', { name: '前往额度中心查看今日领取' })).toBeInTheDocument();
  });

  it('使用英文显示奖励和无障碍操作名称', async () => {
    await act(() => setApplicationLocale('en-US'));
    renderCard();

    expect(screen.getByText('Today’s benefit')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Claim 10 Credits' })).toBeInTheDocument();

    await act(() => setApplicationLocale('zh-CN'));
  });
});
