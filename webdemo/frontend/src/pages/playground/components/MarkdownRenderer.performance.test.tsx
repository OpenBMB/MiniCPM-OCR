import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MarkdownRenderer } from './MarkdownRenderer';

const metrics = vi.hoisted(() => ({ scanned: 0 }));
vi.mock('../utils/math', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/math')>();
  return {
    ...actual,
    normalizeMathDelimiters: (...args: Parameters<typeof actual.normalizeMathDelimiters>) => {
      metrics.scanned += args[0].length;
      return actual.normalizeMathDelimiters(...args);
    },
    normalizeDocumentMathDelimiters: (content: string) => {
      metrics.scanned += content.length;
      return actual.normalizeDocumentMathDelimiters(content);
    },
  };
});

describe('OCR Markdown processing budget', () => {
  it.each([false, true])(
    'should not rescan every text prefix when mapping hundreds of OCR blocks (math=%s)',
    (math) => {
      const paragraphs = Array.from(
        { length: 200 },
        (_, index) => `段落 ${index} ${math ? '\\(a+b\\)' : '正文内容'}`,
      );
      const content = paragraphs.join('\n\n');
      let cursor = 0;
      const linkedRanges = paragraphs.map((paragraph) => {
        const range = { start: cursor, end: cursor + paragraph.length };
        cursor = range.end + 2;
        return { id: paragraph, range };
      });
      metrics.scanned = 0;
      const { container } = render(
        <MarkdownRenderer
          content={content}
          variant="document"
          linkedRanges={linkedRanges}
          editableBlocks
        />,
      );
      expect(container.querySelectorAll('[data-ocr-block-id]')).toHaveLength(200);
      expect(metrics.scanned).toBeLessThanOrEqual(content.length * 4);
    },
  );
});
