import { describe, expect, it } from 'vitest';

import { paneClass } from '../imageParseWorkspaceStyles';

describe('文档双栏布局', () => {
  it('原图栏使用容器百分比，结果栏填满剩余空间，不预留宽分隔带', () => {
    expect(paneClass('origin', false)).toContain('lg:flex-[0_0_var(--map-split)]');
    expect(paneClass('markdown', false)).toContain('lg:flex-1');
    expect(paneClass('markdown', false)).not.toContain('lg:flex-[calc(100_-_var(--map-split))_1_0%]');
    for (const pane of ['origin', 'markdown'] as const) {
      expect(paneClass(pane, true).split(' ')).toContain('transition-none');
      expect(paneClass(pane, false).split(' ')).not.toContain('transition-none');
    }
  });
});
