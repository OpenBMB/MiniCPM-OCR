import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MarkdownRenderer } from '../MarkdownRenderer';
import { ImageParseResultPane } from './ImageParseResultPane';
import type { useImageParse } from '../../hooks/useImageParse';
import { imageParseBlockRanges } from '../../utils/imageParseBlocks';
import {
  IMAGE_PARSE_SAMPLE_BLOCKS,
  IMAGE_PARSE_SAMPLE_MARKDOWN,
} from '../../utils/__tests__/imageParseSampleFixtures';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('OCR 文本高亮保留完整 Markdown', () => {
  it('只定位重复列表项中的第二项，并保留列表结构', () => {
    const content = '- **重复**\n- **重复**';
    const { container } = render(
      <MarkdownRenderer
        content={content}
        variant="document"
        highlightRange={{ start: 9, end: content.length }}
      />,
    );
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
    const highlighted = container.querySelector('[data-ocr-highlight]');
    expect(highlighted).toHaveTextContent('重复');
    expect(highlighted).toBe(container.querySelectorAll('li')[1]);
  });
  it('前文数学定界符规范化不导致后文高亮错位', () => {
    const content = '\\[x^2\\]\n\n## 后文\n\n目标文字';
    const { container } = render(
      <MarkdownRenderer
        content={content}
        variant="document"
        highlightRange={{ start: content.indexOf('目标文字'), end: content.length }}
      />,
    );
    expect(container.querySelector('.katex')).not.toBeNull();
    expect(container.querySelector('[data-ocr-highlight]')).toHaveTextContent('目标文字');
    expect(container.querySelector('h2')).not.toHaveAttribute('data-ocr-highlight');
  });
  it('表格选中后仍保持完整表头与行列', () => {
    const content = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    const { container } = render(
      <MarkdownRenderer
        content={content}
        variant="document"
        highlightRange={{ start: 0, end: content.length }}
      />,
    );
    expect(container.innerHTML).toContain('<table');
    expect(container.querySelectorAll('td')).toHaveLength(2);
    expect(container.querySelector('[data-ocr-highlight] table')).not.toBeNull();
  });
  it('公式经过 KaTeX 渲染后仍保留高亮，任务列表的样式不丢失', () => {
    const content = '$$\nx^2\n$$\n\n- [x] 完成';
    const { container, rerender } = render(
      <MarkdownRenderer
        content={content}
        variant="document"
        highlightRange={{ start: 0, end: 9 }}
      />,
    );
    expect(container.querySelector('[data-ocr-highlight] .katex')).not.toBeNull();
    rerender(
      <MarkdownRenderer
        content={content}
        variant="document"
        highlightRange={{ start: 11, end: content.length }}
      />,
    );
    expect(container.querySelector('[data-ocr-highlight]')).toHaveClass('task-list-item');
  });
  it.each([false, true])(
    '公式只有一份预览和定位入口，兼容旧范围及编辑外壳：%s',
    (editableBlocks) => {
      const formula = String.raw`\left\{\begin{array}{ll}1&(p=q)\\1+failstone(p-q,p)&(p>q)\end{array}\right.`;
      const content = `$$\n${formula}\n$$\n\n${formula}`;
      const start = content.lastIndexOf(formula);
      const { container } = render(
        <MarkdownRenderer
          content={content}
          variant="document"
          editableBlocks={editableBlocks}
          highlightRange={{ start, end: content.length }}
          linkedRanges={[{ id: 'formula', range: { start, end: content.length } }]}
        />,
      );

      const linked = [...container.querySelectorAll<HTMLElement>('[data-ocr-linked-ids]')].filter(
        (node) => JSON.parse(node.dataset.ocrLinkedIds ?? '[]').includes('formula'),
      );
      expect(linked).toHaveLength(1);
      expect(linked[0]?.querySelector('.katex')).not.toBeNull();
      expect(container.querySelectorAll('.katex-display')).toHaveLength(1);
      expect(container.querySelector('p')).toBeNull();
      expect(container.querySelectorAll('[data-ocr-highlight]')).toHaveLength(1);
    },
  );
  it('给可映射的标题、单条列表和整张表附上可点击的原图块标识', () => {
    const content =
      '## 一、会议纪要\n\n- **主题：** Q3 评审\n- **时间：** 14:00\n\n| 项目 | 金额 |\n| --- | --- |\n| GPU | ¥960 |';
    const ranges = [
      { id: 'heading', range: { start: 0, end: content.indexOf('\n') } },
      {
        id: 'topic',
        range: { start: content.indexOf('- **主题'), end: content.indexOf('\n- **时间') },
      },
      { id: 'time', range: { start: content.indexOf('- **时间'), end: content.indexOf('\n\n|') } },
      { id: 'table', range: { start: content.indexOf('| 项目'), end: content.length } },
    ];
    const { container } = render(
      <MarkdownRenderer content={content} variant="document" linkedRanges={ranges} />,
    );
    expect(container.querySelector('h2')).toHaveAttribute('data-ocr-block-id', 'heading');
    expect(container.querySelectorAll('li')[0]).toHaveAttribute('data-ocr-block-id', 'topic');
    expect(container.querySelectorAll('li')[1]).toHaveAttribute('data-ocr-block-id', 'time');
    expect(container.querySelector('table')?.parentElement).toHaveAttribute(
      'data-ocr-block-id',
      'table',
    );
    expect(container.querySelectorAll('[data-ocr-block-id]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-ocr-block-id][tabindex="0"]')).toHaveLength(4);
  });
  it('不给同时包含两个识别块的同一语义节点猜测定位', () => {
    const content = '共同段落';
    const { container } = render(
      <MarkdownRenderer
        content={content}
        variant="document"
        linkedRanges={[
          { id: 'first', range: { start: 0, end: 2 } },
          { id: 'second', range: { start: 2, end: content.length } },
        ]}
      />,
    );
    expect(container.querySelector('[data-ocr-block-id]')).toBeNull();
  });
  it('仅在占位符数量与裁图数量一致时渲染原图裁片', () => {
    const { container, rerender } = render(
      <MarkdownRenderer
        content="![image]()"
        variant="document"
        imageCrops={['data:image/png;base64,AA==']}
      />,
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AA==');
    rerender(
      <MarkdownRenderer
        content="![image]() ![image]()"
        variant="document"
        imageCrops={['data:image/png;base64,AA==']}
      />,
    );
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });
  it('内置样例的标题、会议条目、费用表格都能直接定位到对应识别块', () => {
    const ranges = imageParseBlockRanges(IMAGE_PARSE_SAMPLE_MARKDOWN, IMAGE_PARSE_SAMPLE_BLOCKS);
    const { container } = render(
      <MarkdownRenderer
        content={IMAGE_PARSE_SAMPLE_MARKDOWN}
        variant="document"
        linkedRanges={[...ranges].map(([id, range]) => ({ id, range }))}
      />,
    );
    expect(container.querySelector('h1')).toHaveAttribute('data-ocr-block-id');
    expect(container.querySelectorAll('li')[0]).toHaveAttribute('data-ocr-block-id');
    expect(container.querySelector('table')?.parentElement).toHaveAttribute('data-ocr-block-id');
    expect(container.querySelectorAll('[data-ocr-block-id]').length).toBeGreaterThanOrEqual(14);
  });
  it('点击表格任意单元格及按回车都能直接触发原图定位，普通文本不触发', () => {
    const content = '普通文字\n\n| 项目 | 金额 |\n| --- | --- |\n| GPU | ¥960 |';
    const onSelectBlock = vi.fn();
    const onHoverBlock = vi.fn();
    const parse: ReturnType<typeof useImageParse> = {
      snapshot: null,
      restore: vi.fn(),
      resultKey: 'sample:1',
      documentKey: 'sample:1',
      resultKeyForPage: () => 'sample:1',
      attachment: undefined,
      setAttachment: vi.fn(),
      markdown: content,
      mode: 'standard',
      fields: [],
      upright: true,
      setUpright: vi.fn(),
      recognizeSeal: true,
      setMode: vi.fn(),
      setFields: vi.fn(),
      setRecognizeSeal: vi.fn(),
      recognizeChart: true,
      setRecognizeChart: vi.fn(),
    loading: false,
    finished: false,
      error: undefined,
      progress: null,
      layout: [],
      crops: [],
      pdf: undefined,
      blockedReason: undefined,
      parse: vi.fn(),
      stop: vi.fn(),
      appendDocument: vi.fn(),
      clear: vi.fn(),
      canParse: false,
    };
    const { container } = render(
      <ImageParseResultPane
        parse={parse}
        draft={{
          value: content,
          dirty: false,
          ranges: new Map(),
          setValue: vi.fn(),
          reset: vi.fn(),
        }}
        linkedRanges={[
          {
            id: 'table',
            range: { start: content.indexOf('| 项目'), end: content.length },
          },
        ]}
        onSelectBlock={onSelectBlock}
        onHoverBlock={onHoverBlock}
      />,
    );
    fireEvent.click(screen.getByText('普通文字'));
    expect(onSelectBlock).not.toHaveBeenCalled();
    fireEvent.mouseOver(screen.getByText('¥960'));
    expect(onHoverBlock).toHaveBeenLastCalledWith('table');
    expect(onSelectBlock).not.toHaveBeenCalled();
    fireEvent.mouseLeave(container.querySelector('article')!);
    expect(onHoverBlock).toHaveBeenLastCalledWith(undefined);
    fireEvent.click(screen.getByText('¥960'));
    expect(onSelectBlock).toHaveBeenCalledWith('table');
    fireEvent.keyDown(container.querySelector('[data-ocr-block-id="table"]')!, { key: 'Enter' });
    expect(onSelectBlock).toHaveBeenCalledTimes(2);
  });
  it('同一识别块的页眉三段共用高亮与整块编辑入口', () => {
    const content =
      '上海东洲资产评估有限公司\n\n上海市天山路1717号\n\nTel:86-21-52402166 Fax:86-21-62525086';
    const range = { start: 0, end: content.length };
    const { container } = render(
      <MarkdownRenderer
        content={content}
        variant="document"
        editableBlocks
        highlightRange={range}
        linkedRanges={[{ id: 'footer', range }]}
      />,
    );
    expect(container.querySelectorAll('[data-ocr-highlight]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-ocr-block-id="footer"]')).toHaveLength(1);
    expect(container.querySelector('[data-ocr-group-id="footer"] p')).not.toBeNull();
    expect(container.querySelectorAll('[data-ocr-group-id="footer"] p')).toHaveLength(3);
    expect(container.querySelectorAll('[data-edit-start]')).toHaveLength(1);
    expect(container.querySelector('.katex')).toBeNull();
    expect(container).toHaveTextContent('Tel:86-21-52402166 Fax:86-21-62525086');
  });
  it('服务返回三个识别块时，分别使用各自的编号和位置，不合并相邻段落', () => {
    const content = '公司\n\n地址\n\n电话';
    const parts = ['公司', '地址', '电话'];
    const linkedRanges = parts.map((text, index) => ({
      id: `block-${index + 1}`,
      range: { start: content.indexOf(text), end: content.indexOf(text) + text.length },
    }));
    const { container } = render(
      <MarkdownRenderer
        content={content}
        variant="document"
        editableBlocks
        linkedRanges={linkedRanges}
      />,
    );
    expect(
      [...container.querySelectorAll('[data-ocr-block-id]')].map((node) =>
        node.getAttribute('data-ocr-block-id'),
      ),
    ).toEqual(['block-1', 'block-2', 'block-3']);
    expect(container.querySelector('[data-ocr-group-id]')).toBeNull();
  });
  it('连续选中与切换标签不重建 Markdown 或公式，返回预览后定位同一块', () => {
    const content = '$$\nx^2\n$$\n\n目标文字';
    const links = [
      {
        id: 'target',
        range: { start: content.indexOf('目标文字'), end: content.length },
      },
    ];
    const parse = {
      resultKey: 'stable',
      markdown: content,
      loading: false,
      layout: [],
    } as unknown as ReturnType<typeof useImageParse>;
    const props = {
      parse,
      draft: { value: content, dirty: false, ranges: new Map(), setValue: vi.fn(), reset: vi.fn() },
      json: '',
      linkedRanges: links,
    };
    const scroll = vi.fn();
    HTMLElement.prototype.scrollTo = scroll;
    const { container, rerender } = render(<ImageParseResultPane {...props} tab="preview" />);
    const article = container.querySelector('article')!;
    const formula = article.querySelector('.katex')!;
    const target = article.querySelector('[data-ocr-block-id]')!;
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 20, 50));
    const observer = new MutationObserver(() => undefined);
    observer.observe(article, { childList: true, subtree: true });
    rerender(
      <ImageParseResultPane {...props} tab="source" selectedBlockId="target" focusRequest={1} />,
    );
    expect(
      container.querySelector('[role="tabpanel"][data-state="active"]')?.className,
    ).not.toContain('animate-');
    expect(target).toHaveAttribute('data-ocr-highlight', 'true');
    expect(scroll).not.toHaveBeenCalled();
    rerender(
      <ImageParseResultPane {...props} tab="preview" selectedBlockId="target" focusRequest={2} />,
    );
    expect(scroll).toHaveBeenCalledOnce();
    expect(
      container.querySelector('[role="tabpanel"][data-state="active"]')?.className,
    ).not.toContain('animate-');
    expect(article.querySelector('.katex')).toBe(formula);
    expect(article.querySelector('[data-ocr-block-id]')).toBe(target);
    expect(observer.takeRecords()).toHaveLength(0);
    rerender(<ImageParseResultPane {...props} tab="preview" />);
    expect(target).not.toHaveAttribute('data-ocr-highlight');
    observer.disconnect();
  });

  it('选中结果块时将对应内容跳转到结果栏视口中央', () => {
    const content = '第一段\n\n目标文字\n\n最后一段';
    const focus = vi.fn();
    const parse = {
      resultKey: 'center-focus',
      markdown: content,
      loading: false,
      layout: [],
    } as unknown as ReturnType<typeof useImageParse>;
    const props = {
      parse,
      draft: { value: content, dirty: false, ranges: new Map(), setValue: vi.fn(), reset: vi.fn() },
      json: '',
      linkedRanges: [
        {
          id: 'target',
          range: { start: content.indexOf('目标文字'), end: content.indexOf('目标文字') + 4 },
        },
      ],
      onPreviewFocus: focus,
    };
    const { container, rerender } = render(<ImageParseResultPane {...props} tab="preview" />);
    const viewport = container.querySelector<HTMLElement>('[data-ocr-result-scroll]')!;
    const target = container.querySelector<HTMLElement>('[data-ocr-block-id="target"]')!;
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1_000 },
    });
    viewport.scrollTop = 100;
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 500, 400));
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 600, 300, 100));

    rerender(
      <ImageParseResultPane {...props} tab="preview" selectedBlockId="target" focusRequest={1} />,
    );

    expect(focus).toHaveBeenCalledWith(550);
  });
});
