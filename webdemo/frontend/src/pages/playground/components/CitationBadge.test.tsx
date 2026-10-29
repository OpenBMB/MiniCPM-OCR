import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@map/ui';

import '@/i18n';

import { CitationBadge } from './CitationBadge';

const citation = {
  url: 'https://www.openbmb.cn/news',
  title: 'MiniCPM 官方说明',
  snippet: '这里是来源摘要，用于在不离开回答时快速判断来源是否相关。',
};

/** 替身弹窗：记录 openCitationWindow 最终跳到哪个地址。 */
function stubPopup() {
  const replace = vi.fn();
  const popup = { opener: {}, location: { replace } } as unknown as Window;
  const open = vi.spyOn(window, 'open').mockReturnValue(popup);
  return { open, replace };
}

function renderBadge(index = 2, url = citation.url, onActivate?: () => void) {
  return render(
    <TooltipProvider>
      <p>
        结论如此
        <CitationBadge citation={{ ...citation, url }} index={index} onActivate={onActivate} />。
      </p>
    </TooltipProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CitationBadge', () => {
  it('渲染为带序号的数字角标', () => {
    renderBadge();

    const badge = screen.getByRole('link', { name: '第 2 个来源' });
    expect(badge).toHaveTextContent('2');
    expect(badge).toHaveAttribute('data-citation-badge');
    expect(badge).toHaveAttribute('data-citation-url', citation.url);
    // 相对定位上移而非 <sup>：不参与行盒计算，正文行高不被撑开
    expect(badge).toHaveClass('relative', '-top-[0.3em]');
  });

  it('悬浮时展示来源预览卡', async () => {
    const user = userEvent.setup();
    renderBadge();

    await user.hover(screen.getByRole('link', { name: '第 2 个来源' }));

    expect(await screen.findAllByText(citation.snippet)).not.toHaveLength(0);
    expect(await screen.findAllByText(citation.title)).not.toHaveLength(0);
  });

  it('接了 onActivate 时点击交给来源面板，不再开新窗口', async () => {
    const user = userEvent.setup();
    const { open } = stubPopup();
    const onActivate = vi.fn();
    renderBadge(2, citation.url, onActivate);

    await user.click(screen.getByRole('link', { name: '第 2 个来源' }));

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it('接了 onActivate 时，修饰键点击仍走浏览器原生打开', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    renderBadge(2, citation.url, onActivate);

    await user.keyboard('{Meta>}');
    await user.click(screen.getByRole('link', { name: '第 2 个来源' }));
    await user.keyboard('{/Meta}');

    expect(onActivate).not.toHaveBeenCalled();
  });

  it('点击在新窗口打开原文，不做同窗口跳转', async () => {
    const user = userEvent.setup();
    const { open, replace } = stubPopup();
    renderBadge();

    await user.click(screen.getByRole('link', { name: '第 2 个来源' }));

    expect(open).toHaveBeenCalledWith('about:blank', '_blank', 'noopener,noreferrer');
    expect(replace).toHaveBeenCalledWith(citation.url);
  });

  it('带修饰键点击时交回浏览器原生行为', async () => {
    const user = userEvent.setup();
    const { open } = stubPopup();
    renderBadge();

    await user.keyboard('{Meta>}');
    await user.click(screen.getByRole('link', { name: '第 2 个来源' }));
    await user.keyboard('{/Meta}');

    expect(open).not.toHaveBeenCalled();
  });

  it('非 HTTP(S) 地址退化为不可点的纯数字', () => {
    renderBadge(1, 'javascript:alert(1)');

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    const badge = screen.getByLabelText('第 1 个来源');
    expect(badge.tagName).toBe('SPAN');
    expect(badge).toHaveTextContent('1');
  });
});
