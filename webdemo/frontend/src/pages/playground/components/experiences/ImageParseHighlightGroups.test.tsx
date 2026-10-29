import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MarkdownRenderer } from '../MarkdownRenderer';
import type { useImageParse } from '../../hooks/useImageParse';
import { useImageParseDraft } from '../../hooks/useImageParseDraft';
import { ImageParseResultPane } from './ImageParseResultPane';
import { IMAGE_PARSE_SAMPLE_BLOCKS } from '../../utils/__tests__/imageParseSampleFixtures';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('OCR 结果按识别块统一高亮', () => {
  it.each([false, true])(
    '35 段正文只生成一个定位、高亮和整块编辑入口，编辑=%s',
    (editableBlocks) => {
      const content = Array.from({ length: 35 }, (_, index) => `配置第 ${index + 1} 行`).join(
        '\n\n',
      );
      const range = { start: 0, end: content.length };
      const { container } = render(
        <MarkdownRenderer
          content={content}
          variant="document"
          editableBlocks={editableBlocks}
          highlightRange={range}
          linkedRanges={[{ id: 'ocr-4', range }]}
        />,
      );

      expect(container.querySelectorAll('[data-ocr-highlight="true"]')).toHaveLength(1);
      expect(container.querySelectorAll('[data-ocr-block-id="ocr-4"]')).toHaveLength(1);
      expect(container.querySelectorAll('[data-ocr-group-id="ocr-4"] p')).toHaveLength(35);
      const editBlocks = container.querySelectorAll('[data-edit-start]');
      expect(editBlocks).toHaveLength(editableBlocks ? 1 : 0);
      if (editableBlocks) {
        expect(editBlocks[0]).toHaveAttribute('data-edit-start', '0');
        expect(editBlocks[0]).toHaveAttribute('data-edit-end', String(content.length));
      }
      expect(container.querySelector('[data-ocr-group-id] [data-ocr-linked-ids]')).toBeNull();
    },
  );

  it.each(['- 第一项\n- 第二项', '1. 第一项\n2. 第二项'])(
    '同一区块的完整列表统一高亮且不破坏列表结构：%s',
    (content) => {
      const range = { start: 0, end: content.length };
      const { container } = render(
        <MarkdownRenderer
          content={content}
          variant="document"
          editableBlocks
          highlightRange={range}
          linkedRanges={[{ id: 'list', range }]}
        />,
      );

      expect(container.querySelectorAll('[data-ocr-highlight="true"]')).toHaveLength(1);
      expect(container.querySelectorAll('[data-ocr-group-id="list"] li')).toHaveLength(2);
      expect(container.querySelectorAll('[data-edit-start]')).toHaveLength(1);
      expect(container.querySelector('ul > div, ol > div')).toBeNull();
    },
  );

  it('正文、表格、公式与代码同属一个区块时只绘制外框', () => {
    const content =
      '说明文字\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n$$\nx^2\n$$\n\n```yaml\nname: demo\n```';
    const range = { start: 0, end: content.length };
    const { container } = render(
      <MarkdownRenderer
        content={content}
        variant="document"
        editableBlocks
        highlightRange={range}
        linkedRanges={[{ id: 'mixed', range }]}
      />,
    );
    const group = container.querySelector('[data-ocr-group-id="mixed"]')!;

    expect(container.querySelectorAll('[data-ocr-highlight="true"]')).toHaveLength(1);
    expect(group.querySelectorAll('table td')).toHaveLength(2);
    expect(group.querySelectorAll('.katex-display')).toHaveLength(1);
    expect(group.querySelector('pre code')).toHaveTextContent('name: demo');
    expect(group.querySelectorAll('[data-edit-start]')).toHaveLength(1);
    expect(group.querySelector('[data-edit-start]')).toHaveAttribute('data-edit-start', '0');
    expect(group.querySelector('[data-edit-start]')).toHaveAttribute(
      'data-edit-end',
      String(content.length),
    );
    expect(group.querySelector('[data-ocr-highlight]')).toBeNull();
  });

  it('公式规范化后整块编辑仍使用原始源范围，不包含前后相邻区块', () => {
    const before = '\\[x^2\\]\n\n';
    const fragment = '正文 \\(a+b\\)\n\n第二段';
    const content = before + fragment + '\n\n结尾';
    const range = { start: before.length, end: before.length + fragment.length };
    const { container } = render(
      <MarkdownRenderer
        content={content}
        variant="document"
        editableBlocks
        linkedRanges={[{ id: 'group', range }]}
      />,
    );
    const group = container.querySelector('[data-ocr-group-id="group"]')!;
    const editor = group.querySelector('[data-edit-start]')!;
    expect(editor).toHaveAttribute('data-edit-start', String(range.start));
    expect(editor).toHaveAttribute('data-edit-end', String(range.end));
    expect(editor.querySelectorAll('p')).toHaveLength(2);
    expect(container.querySelectorAll('[data-edit-start]')).toHaveLength(3);
    expect(group).not.toHaveTextContent('结尾');
  });

  it('不跨越其他识别块或未映射正文合并同名范围', () => {
    const content = '第一段\n\n中间正文\n\n第三段';
    const { container } = render(
      <MarkdownRenderer
        content={content}
        variant="document"
        linkedRanges={[
          { id: 'same', range: { start: 0, end: 3 } },
          { id: 'same', range: { start: content.indexOf('第三段'), end: content.length } },
        ]}
      />,
    );

    expect(container.querySelectorAll('[data-ocr-block-id="same"]')).toHaveLength(2);
    expect(container.querySelector('[data-ocr-group-id]')).toBeNull();
    expect(screen.getByText('中间正文')).not.toHaveAttribute('data-ocr-linked-ids');
  });

  it('悬停和选择只标记整体范围，点击内部段落仍定位同一区块', () => {
    const content = '第一段\n\n第二段\n\n第三段';
    const onSelectBlock = vi.fn();
    const range = { start: 0, end: content.length };
    const parse = {
      resultKey: 'grouped-image',
      markdown: content,
      layout: [],
      loading: false,
    } as unknown as ReturnType<typeof useImageParse>;
    const props = {
      parse,
      draft: { value: content, dirty: false, ranges: new Map(), setValue: vi.fn(), reset: vi.fn() },
      linkedRanges: [{ id: 'group', range }],
      onSelectBlock,
    };
    const { container, rerender } = render(
      <ImageParseResultPane {...props} hoveredBlockId="group" />,
    );

    expect(container.querySelectorAll('[data-ocr-hover="true"]')).toHaveLength(1);
    const paragraph = screen.getByText('第二段');
    fireEvent.click(paragraph);
    expect(onSelectBlock).toHaveBeenCalledExactlyOnceWith('group');
    rerender(<ImageParseResultPane {...props} selectedBlockId="group" />);
    expect(container.querySelectorAll('[data-ocr-highlight="true"]')).toHaveLength(1);
    expect(container.querySelector('[data-ocr-hover]')).toBeNull();
    expect(screen.getByText('第二段')).toBe(paragraph);
    expect(container.querySelectorAll('[data-edit-block]')).toHaveLength(1);
  });

  it('PDF 同名多段区块只高亮当前页，切页不重建前页正文', () => {
    const first = '第1页第一段\n\n第1页第二段';
    const second = '第2页第一段\n\n第2页第二段';
    const onSelectBlock = vi.fn();
    function Workspace({ page }: { page: number }) {
      const results = Object.fromEntries(
        [first, second].map((markdown, index) => [
          index + 1,
          {
            result: {
              markdown,
              blocks: [{ ...IMAGE_PARSE_SAMPLE_BLOCKS[2], id: 'same', markdown }],
            },
          },
        ]),
      );
      const parse = {
        resultKey: `grouped-pdf:${page}`,
        resultKeyForPage: (number: number) => `grouped-pdf:${number}`,
        markdown: results[page].result.markdown,
        layout: results[page].result.blocks,
        loading: false,
        pdf: { page, pages: 2, results, loading: false, setPage: vi.fn() },
      } as unknown as ReturnType<typeof useImageParse>;
      const draft = useImageParseDraft(parse.markdown, parse.resultKey);
      return (
        <ImageParseResultPane
          parse={parse}
          draft={draft}
          selectedBlockId="same"
          onSelectBlock={onSelectBlock}
        />
      );
    }
    const { container, rerender } = render(<Workspace page={1} />);
    const paragraph = screen.getByText('第1页第二段');

    expect(container.querySelectorAll('[data-ocr-highlight="true"]')).toHaveLength(1);
    expect(container.querySelector('[data-ocr-highlight="true"]')).toHaveTextContent('第1页第二段');
    expect(container.querySelectorAll('[data-edit-block]')).toHaveLength(2);
    fireEvent.click(screen.getByText('第2页第二段'));
    expect(onSelectBlock).toHaveBeenCalledExactlyOnceWith('same', 2);
    rerender(<Workspace page={2} />);
    expect(container.querySelectorAll('[data-ocr-highlight="true"]')).toHaveLength(1);
    expect(container.querySelector('[data-ocr-highlight="true"]')).toHaveTextContent('第2页第二段');
    expect(screen.getByText('第1页第二段')).toBe(paragraph);
  });
});
