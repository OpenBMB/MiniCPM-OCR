import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Dialog, DialogContent, DialogTitle } from './dialog';

describe('DialogContent', () => {
  it('在内容超出最大高度时由主体滚动而不是裁切', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>测试弹窗</DialogTitle>
          <div>内容</div>
        </DialogContent>
      </Dialog>,
    );

    expect(document.querySelector('[data-slot="dialog-scroll-body"]')).toHaveClass('min-h-0');
  });
});
