import { memo, useContext } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ImageParseBlockEditContext } from '../../utils/imageParseBlockEditContext';
import { ImageParseVisualEditor } from './ImageParseVisualEditor';

describe('OCR editor context stability', () => {
  it('should not update every document block on unrelated parent updates', () => {
    const renderBlock = vi.fn();
    const Block = memo(function Block() {
      useContext(ImageParseBlockEditContext);
      renderBlock();
      return <p>稳定正文</p>;
    });
    const child = <Block />;
    const view = render(
      <ImageParseVisualEditor source="稳定正文" loading={false} onSave={vi.fn()}>
        {child}
      </ImageParseVisualEditor>,
    );
    expect(renderBlock).toHaveBeenCalledOnce();
    view.rerender(
      <ImageParseVisualEditor source="稳定正文" loading={false} onSave={vi.fn()}>
        {child}
      </ImageParseVisualEditor>,
    );
    expect(renderBlock).toHaveBeenCalledOnce();
  });
});
