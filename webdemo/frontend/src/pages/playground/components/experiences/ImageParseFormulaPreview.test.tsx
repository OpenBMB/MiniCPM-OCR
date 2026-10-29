import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MarkdownRenderer } from '../MarkdownRenderer';

const formula = String.raw`\frac{p}{q}`;
const display = `$$\n${formula}\n$$`;

describe('OCR 公式预览去重边界', () => {
  it('没有区块映射的旧文档也只展示一份公式，不修改聊天正文', () => {
    const content = `${display}\n\n${formula}`;
    const { container, rerender } = render(
      <MarkdownRenderer content={content} variant="document" editableBlocks />,
    );
    expect(container.querySelectorAll('.katex-display')).toHaveLength(1);
    expect(container.querySelector('p')).toBeNull();
    rerender(<MarkdownRenderer content={content} />);
    expect(container.querySelectorAll('.katex-display')).toHaveLength(2);
  });

  it('相同公式之间存在其它正文时不删除或错误绑定后面的原文', () => {
    const content = `${display}\n\n公式说明\n\n${formula}`;
    const start = content.lastIndexOf(formula);
    const { container } = render(
      <MarkdownRenderer
        content={content}
        variant="document"
        editableBlocks
        linkedRanges={[{ id: 'raw', range: { start, end: content.length } }]}
      />,
    );
    const linked = container.querySelector('[data-ocr-block-id="raw"]');
    expect(linked?.tagName).toBe('P');
    expect(linked?.querySelector('.katex')).toBeNull();
    expect(container.querySelectorAll('p')).toHaveLength(2);
  });

  it('两个不同原图区域的相同公式分别保留定位入口', () => {
    const content = `${display}\n\n${formula}`;
    const start = content.lastIndexOf(formula);
    const { container } = render(
      <MarkdownRenderer
        content={content}
        variant="document"
        editableBlocks
        linkedRanges={[
          { id: 'display', range: { start: 0, end: display.length } },
          { id: 'raw', range: { start, end: content.length } },
        ]}
      />,
    );
    expect(container.querySelector('[data-ocr-block-id="display"] .katex')).not.toBeNull();
    expect(container.querySelector('[data-ocr-block-id="raw"]')?.tagName).toBe('P');
  });
});
