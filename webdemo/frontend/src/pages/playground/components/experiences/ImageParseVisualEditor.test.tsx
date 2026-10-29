import { StrictMode, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { MarkdownRenderer } from '../MarkdownRenderer';
import { ImageParseVisualEditor } from './ImageParseVisualEditor';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  document.elementFromPoint = () => document.activeElement;
  HTMLElement.prototype.scrollIntoView = () => undefined;
});

function Harness({ initial, onSave }: { initial: string; onSave: (value: string) => void }) {
  const [source, setSource] = useState(initial);
  return (
    <>
      <ImageParseVisualEditor
        source={source}
        loading={false}
        onSave={(value) => {
          onSave(value);
          setSource(value);
        }}
      >
        <MarkdownRenderer content={source} variant="document" editableBlocks />
      </ImageParseVisualEditor>
      <button>外部</button>
      <output data-testid="source">{source}</output>
    </>
  );
}
async function begin(text: string) {
  fireEvent.doubleClick(screen.getByText(text, { selector: 'p,h2,td,a' }));
  const element = await screen.findByRole('textbox', { name: 'imageParseInlineEditor' });
  await waitFor(() => expect(element).toHaveFocus());
  return { element, instance: (element as HTMLElement & { editor: Editor }).editor };
}
function outside() {
  fireEvent.pointerDown(screen.getByRole('button', { name: '外部' }));
}

describe('OCR 单块编辑生命周期', () => {
  it('页码语义块右对齐弱化，避免选中时铺满整行', () => {
    const source = '正文\n\n23';
    const range = { start: source.indexOf('23'), end: source.length };
    const { container } = render(
      <ImageParseVisualEditor
        source={source}
        loading={false}
        onSave={vi.fn()}
        pageNumberRanges={new Set([`${range.start}:${range.end}`])}
      >
        <MarkdownRenderer
          content={source}
          variant="document"
          editableBlocks
          highlightRange={range}
          linkedRanges={[{ id: 'page-number', range }]}
        />
      </ImageParseVisualEditor>,
    );

    const pageNumber = container.querySelector('[data-page-number="true"]');
    expect(pageNumber).toHaveClass('justify-end');
    expect(pageNumber?.querySelector('p')).toHaveTextContent('23');
    expect(pageNumber?.querySelector('p')).toHaveAttribute('data-ocr-highlight', 'true');
  });

  it('同一 OCR 区块合并高亮后，双击任意段落编辑整体且无修改退出保留外框', async () => {
    const source = '第一段\n\n第二段\n\n第三段';
    const onSave = vi.fn();
    const { container } = render(
      <>
        <ImageParseVisualEditor source={source} loading={false} onSave={onSave}>
          <MarkdownRenderer
            content={source}
            variant="document"
            editableBlocks
            highlightRange={{ start: 0, end: source.length }}
            linkedRanges={[{ id: 'group', range: { start: 0, end: source.length } }]}
          />
        </ImageParseVisualEditor>
        <button>外部</button>
      </>,
    );
    const group = container.querySelector('[data-ocr-group-id="group"]');
    const { element, instance } = await begin('第二段');
    expect(element).toHaveTextContent('第二段');
    expect(element).toHaveTextContent('第一段');
    expect(element).toHaveTextContent('第三段');
    expect(container.querySelectorAll('[data-edit-block]')).toHaveLength(1);
    expect(group?.querySelector('p')).toBe(element.querySelector('p'));
    outside();

    expect(instance.isDestroyed).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
    expect(container.querySelector('[data-ocr-group-id="group"]')).toBe(group);
    expect(container.querySelectorAll('[data-ocr-highlight="true"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-edit-block] p')).toHaveLength(3);
  });

  it('整块编辑只保存当前 OCR 范围，取消不会回写整块草稿', async () => {
    const before = '## 前一个区块\n\n';
    const fragment = '第一段\n\n第二段\n\n第三段';
    const after = '\n\n后一个区块';
    const source = before + fragment + after;
    const range = { start: before.length, end: before.length + fragment.length };
    const onSave = vi.fn();
    const { container } = render(
      <>
        <ImageParseVisualEditor source={source} loading={false} onSave={onSave}>
          <MarkdownRenderer
            content={source}
            variant="document"
            editableBlocks
            highlightRange={range}
            linkedRanges={[{ id: 'group', range }]}
          />
        </ImageParseVisualEditor>
        <button>外部</button>
      </>,
    );
    const first = await begin('第二段');
    expect(first.element.querySelectorAll('p')).toHaveLength(3);
    expect(first.element).not.toHaveTextContent('前一个区块');
    expect(first.element).not.toHaveTextContent('后一个区块');
    expect(container.querySelectorAll('[data-edit-block]')).toHaveLength(3);
    const second = first.element.querySelectorAll('p')[1].firstChild!;
    const start = first.instance.view.posAtDOM(second, 0);
    first.instance.commands.insertContentAt({ from: start, to: start + '第二段'.length }, '修改后');
    outside();
    expect(onSave).toHaveBeenCalledExactlyOnceWith(
      before + fragment.replace('第二段', '修改后') + after,
      range,
    );

    onSave.mockClear();
    const next = await begin('第三段');
    await userEvent.clear(next.element);
    await userEvent.type(next.element, '放弃本次整块修改');
    fireEvent.keyDown(next.element, { key: 'Escape' });
    expect(next.instance.isDestroyed).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('第一段')).toBeInTheDocument();
    expect(screen.getByText('第二段')).toBeInTheDocument();
    expect(screen.getByText('第三段')).toBeInTheDocument();
  });

  it('整块只有一个键盘编辑入口，回车包含整块表格和公式', async () => {
    const source = '说明\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n$$\na^2\n$$\n\n结尾';
    const range = { start: 0, end: source.length };
    const onSave = vi.fn();
    const { container } = render(
      <ImageParseVisualEditor source={source} loading={false} onSave={onSave}>
        <MarkdownRenderer
          content={source}
          variant="document"
          editableBlocks
          linkedRanges={[{ id: 'mixed', range }]}
        />
      </ImageParseVisualEditor>,
    );
    const target = container.querySelector<HTMLElement>('[data-edit-block]')!;
    expect(container.querySelectorAll('[data-edit-block]')).toHaveLength(1);
    expect(target).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(target, { key: 'Enter' });
    const element = await screen.findByRole('textbox', { name: 'imageParseInlineEditor' });
    expect(element).toHaveTextContent('说明');
    expect(element).toHaveTextContent('结尾');
    expect(element.querySelectorAll('td')).toHaveLength(2);
    expect(element.querySelector('[data-type="block-math"]')).toHaveAttribute('data-latex', 'a^2');
    fireEvent.keyDown(element, { key: 'Escape' });
    expect(onSave).not.toHaveBeenCalled();
    expect(container.querySelectorAll('[data-edit-block]')).toHaveLength(1);
  });

  it('按需创建唯一实例，外部点击保存当前块并同步销毁，其余原文保持一致', async () => {
    const source = '## 标题\n\n原始文本\n\n![image]()\n\n结尾  **加粗**\n';
    const onSave = vi.fn();
    render(
      <StrictMode>
        <Harness initial={source} onSave={onSave} />
      </StrictMode>,
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    const { element, instance } = await begin('原始文本');
    expect(element).toHaveTextContent('原始文本');
    expect(element).not.toHaveTextContent('标题');
    expect(screen.getByRole('heading', { name: '标题' })).toBeInTheDocument();
    await userEvent.clear(element);
    await userEvent.type(element, '修改后');
    outside();
    expect(instance.isDestroyed).toBe(true);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(onSave).toHaveBeenCalledWith(source.replace('原始文本', '修改后'));
    const next = await begin('标题');
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(instance.isDestroyed).toBe(true);
    outside();
    expect(next.instance.isDestroyed).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('表格完整导入合并和空格子；工具栏不失焦，键盘移出恢复预览', async () => {
    const source =
      '## 标题\n\n<table><tr><th colspan="2">表头</th></tr><tr><td rowspan="2">原值</td><td></td></tr><tr><td>A &amp; B</td></tr></table>\n\n$a^2$';
    const onSave = vi.fn();
    const { container } = render(<Harness initial={source} onSave={onSave} />);
    const { element, instance } = await begin('原值');
    expect(element.querySelector('th')).toHaveAttribute('colspan', '2');
    expect(element.querySelector('td')).toHaveAttribute('rowspan', '2');
    const toolbar = screen.getByRole('button', { name: 'imageParseEditorBold' });
    fireEvent.pointerDown(toolbar);
    fireEvent.blur(element, { relatedTarget: toolbar });
    expect(instance.isDestroyed).toBe(false);
    fireEvent.focusOut(toolbar, { relatedTarget: screen.getByRole('button', { name: '外部' }) });
    expect(instance.isDestroyed).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('th')).toHaveAttribute('colspan', '2');
  });

  it('转义换行在编辑中保留，未修改时不回写原始正文', async () => {
    const source = '<table><tr><td>第一行&lt;br&gt;第二行</td></tr></table>';
    const doubleEscaped = '<table><tr><td>第一行&amp;lt;br&amp;gt;第二行</td></tr></table>';

    const onSave = vi.fn();
    const first = render(<Harness initial={source} onSave={onSave} />);
    expect(first.container.querySelectorAll('td br')).toHaveLength(1);
    const { element } = await begin('第一行第二行');
    expect(element.querySelectorAll('td br')).toHaveLength(1);
    expect(element.textContent).not.toContain('<br>');
    outside();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId('source').textContent).toBe(source);
    expect(first.container.querySelectorAll('td br')).toHaveLength(1);

    first.unmount();
    const second = render(<Harness initial={doubleEscaped} onSave={vi.fn()} />);
    expect(second.container.querySelectorAll('td br')).toHaveLength(1);
    expect(second.container.textContent).not.toContain('&lt;br&gt;');
  });

  it('切换前销毁旧实例，Escape 放弃编辑，引用链接仍使用整份文档定义', async () => {
    const source = '第一段\n\n[参考][ref]\n\n[ref]: https://example.com "来源"\n';
    const onSave = vi.fn();
    render(<Harness initial={source} onSave={onSave} />);
    const first = await begin('第一段');
    fireEvent.doubleClick(screen.getByText('参考'));
    await waitFor(() => expect(first.instance.isDestroyed).toBe(true));
    const second = await screen.findByRole('textbox');
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(second.querySelector('a')).toHaveAttribute('href', 'https://example.com');
    await userEvent.clear(second);
    await userEvent.type(second, '取消');
    fireEvent.keyDown(second, { key: 'Escape' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId('source')).toHaveTextContent('第一段');
  });

  it('结果切换丢弃旧编辑，加载期间和图片占位符不挂载编辑器', async () => {
    const onSave = vi.fn();
    const view = render(
      <ImageParseVisualEditor source="旧结果" loading={false} onSave={onSave}>
        <MarkdownRenderer content="旧结果" variant="document" editableBlocks />
      </ImageParseVisualEditor>,
    );
    const old = await begin('旧结果');
    await userEvent.type(old.element, '未保存');
    view.rerender(
      <ImageParseVisualEditor source={'新结果\n\n![image]()'} loading onSave={onSave}>
        <MarkdownRenderer content={'新结果\n\n![image]()'} variant="document" editableBlocks />
      </ImageParseVisualEditor>,
    );
    await waitFor(() => expect(old.instance.isDestroyed).toBe(true));
    fireEvent.doubleClick(screen.getByText('新结果'));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('输入法未结束时不销毁编辑器，结束后保存最后字符', async () => {
    const onSave = vi.fn();
    render(<Harness initial="原文" onSave={onSave} />);
    const { element, instance } = await begin('原文');
    await userEvent.clear(element);
    await userEvent.type(element, '中文内容');
    const composition = vi.spyOn(instance.view, 'composing', 'get').mockReturnValue(true);
    outside();
    expect(instance.isDestroyed).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
    composition.mockReturnValue(false);
    fireEvent.compositionEnd(element);
    await waitFor(() => expect(instance.isDestroyed).toBe(true));
    expect(onSave).toHaveBeenCalledWith('中文内容');
    composition.mockRestore();
  });
});
