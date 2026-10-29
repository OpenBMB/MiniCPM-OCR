import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MarkdownRenderer } from './MarkdownRenderer';

describe('OCR 文档数学正文完整性', () => {
  it.each([
    String.raw`\text{cost \$5}`,
    String.raw`\verb|$a$|`,
    String.raw`\verb|$$a$$|`,
  ])('原生行内公式 %s 不被内部美元符截断', (latex) => {
    const content = `前\\(${latex}\\)后\n\n\\(b^2\\)`;
    const { container } = render(<MarkdownRenderer variant="document" content={content} />);
    expect(container.querySelectorAll('.katex')).toHaveLength(2);
    expect(container.querySelectorAll('.katex-error')).toHaveLength(0);
    expect([...container.querySelectorAll('annotation')].map((node) => node.textContent)).toEqual([
      latex,
      'b^2',
    ]);
    expect(container.querySelectorAll('.katex-display')).toHaveLength(0);
  });

  it('原生块级公式的显示模式、原图联动和可编辑块范围一致', () => {
    const latex = String.raw`\int_0^\infty e^{-x^2}\,dx=\frac{\sqrt{\pi}}2\tag{1}`;
    const formula = `\\[${latex}\\]`;
    const content = `前言\n\n${formula}\n\n\\(c^2\\)`;
    const range = { start: content.indexOf(formula), end: content.indexOf(formula) + formula.length };
    const { container } = render(
      <MarkdownRenderer
        variant="document"
        content={content}
        editableBlocks
        highlightRange={range}
        linkedRanges={[{ id: 'integral', range }]}
      />,
    );
    expect(container.querySelectorAll('.katex-display')).toHaveLength(1);
    expect(container.querySelectorAll('.katex-error')).toHaveLength(0);
    expect(container.querySelector('annotation')).toHaveTextContent(latex);
    const block = container.querySelector(`[data-edit-start="${range.start}"]`);
    expect(block).toHaveAttribute('data-edit-end', String(range.end));
    expect(block?.querySelector('[data-ocr-block-id="integral"]')).toHaveAttribute(
      'data-ocr-highlight',
      'true',
    );
  });
});
