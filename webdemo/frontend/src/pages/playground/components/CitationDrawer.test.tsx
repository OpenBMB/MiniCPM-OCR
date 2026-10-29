import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { CitationDrawer } from './CitationDrawer';

const citations = [
  { url: 'https://www.openbmb.cn/news', title: 'MiniCPM 官方说明', snippet: '摘要一' },
  { url: 'https://example.com/a?b=1&a=2', title: '示例来源', snippet: '摘要二' },
  { url: 'https://example.org/c', title: '第三个来源', snippet: '摘要三' },
];

function renderDrawer(activeUrl?: string) {
  return render(
    <CitationDrawer citations={citations} activeUrl={activeUrl} onClose={() => undefined} />,
  );
}

/** jsdom does not implement scrollIntoView; install a stub per case and return it so location behavior can be asserted. */
function stubScrollIntoView() {
  const scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  return scrollIntoView;
}

/** Source with a backend number: the number is deliberately offset from the array index. */
const refCitations = [
  { ref: 2, url: 'https://www.openbmb.cn/news', title: 'MiniCPM 官方说明' },
  { ref: 5, url: 'https://example.com/a', title: '示例来源' },
];

describe('CitationDrawer', () => {
  beforeEach(() => {
    stubScrollIntoView();
  });

  it('按顺序列出全部来源', () => {
    renderDrawer();

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveAccessibleName(/MiniCPM 官方说明/);
    // Without activeUrl, no item should be marked current
    expect(document.querySelector('[aria-current="true"]')).toBeNull();
  });

  it('列表序号取后端下发的 ref，与正文角标同号', () => {
    render(<CitationDrawer citations={refCitations} onClose={() => undefined} />);

    // Array indexes would yield 01 and 02; the body badges say 02 and 05. Different numbers in the two places means you cannot click back.
    expect(screen.getByText('02')).toBeInTheDocument();
    expect(screen.getByText('05')).toBeInTheDocument();
    expect(screen.queryByText('01')).toBeNull();
  });

  it('activeUrl 命中的条目进入选中态并标注 aria-current', () => {
    renderDrawer(citations[2].url);

    const active = screen.getByRole('link', { name: /第三个来源/ });
    expect(active).toHaveAttribute('aria-current', 'true');
    expect(active).toHaveClass('bg-primary/[0.12]', 'ring-1', 'ring-primary/30');
    // Only the matching item is current
    expect(document.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
  });

  it('URL 仅差查询参数顺序时仍能匹配到同一条', () => {
    renderDrawer('https://example.com/a?a=2&b=1');

    expect(screen.getByRole('link', { name: /示例来源/ })).toHaveAttribute('aria-current', 'true');
  });

  it('把命中条目滚进视野，且只在确实不可见时滚动', () => {
    const scrollIntoView = stubScrollIntoView();
    renderDrawer(citations[1].url);

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
  });

  it('没有 activeUrl 时不触发滚动', () => {
    const scrollIntoView = stubScrollIntoView();
    renderDrawer();

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
