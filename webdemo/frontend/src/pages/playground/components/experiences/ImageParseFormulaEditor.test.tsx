import { useState } from 'react';
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
          setSource(value);
          onSave(value);
        }}
      >
        <MarkdownRenderer content={source} variant="document" editableBlocks />
      </ImageParseVisualEditor>
      <button>外部</button>
      <output data-testid="source">{source}</output>
    </>
  );
}

describe('OCR 公式源码编辑', () => {
  it('双击块级公式即可修改 LaTeX，失焦只保存一份公式并保留其它原文', async () => {
    const source = '前文  **原样保留**\n\n$$\na^2\n$$\n\n后文\n';
    const onSave = vi.fn();
    const { container } = render(<Harness initial={source} onSave={onSave} />);
    fireEvent.doubleClick(container.querySelector('.katex')!);
    const input = await screen.findByRole('textbox', { name: 'imageParseFormulaSource' });
    expect(input).toHaveValue('a^2');
    fireEvent.pointerDown(input);
    fireEvent.change(input, { target: { value: String.raw`\frac{a}{b}` } });
    await waitFor(() =>
      expect(container.querySelector('[data-type="block-math"]')).toHaveAttribute(
        'data-latex',
        String.raw`\frac{a}{b}`,
      ),
    );
    expect(container.querySelectorAll('.katex-display')).toHaveLength(0);
    fireEvent.pointerDown(screen.getByRole('button', { name: '外部' }));
    expect(onSave).toHaveBeenCalledWith(source.replace('a^2', String.raw`\frac{a}{b}`));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.katex-display')).toHaveLength(1);
  });

  it('行内公式可独立选中、修改、撤销和重做，不修改相邻公式', async () => {
    const source = '正文 $a^2$ 与 $b^2$。\n\n结尾';
    const onSave = vi.fn();
    const { container } = render(<Harness initial={source} onSave={onSave} />);
    fireEvent.doubleClick(container.querySelector('.katex')!);
    const element = await screen.findByRole('textbox', { name: 'imageParseInlineEditor' });
    const input = await screen.findByRole('textbox', { name: 'imageParseFormulaSource' });
    expect(input).toHaveValue('a^2');
    fireEvent.change(input, { target: { value: 'a^3' } });
    const undo = screen.getByRole('button', { name: 'imageParseEditorUndo' });
    await waitFor(() => expect(undo).toBeEnabled());
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'imageParseFormulaSource' })).toHaveValue('a^2'),
    );
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true, shiftKey: true });
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'imageParseFormulaSource' })).toHaveValue('a^3'),
    );
    fireEvent.blur(input, { relatedTarget: element });
    expect(container.querySelectorAll('.tiptap .katex-display')).toHaveLength(0);
    expect(
      [...container.querySelectorAll('.tiptap annotation')].map((node) => node.textContent),
    ).toEqual(['a^3', 'b^2']);
    fireEvent.pointerDown(screen.getByRole('button', { name: '外部' }));
    expect(onSave).toHaveBeenCalledWith(source.replace('$a^2$', '$a^3$'));
  });

  it('在公式源码中间输入时保留当前光标位置', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness initial="正文 $abcdef$。" onSave={vi.fn()} />);
    fireEvent.doubleClick(container.querySelector('.katex')!);
    const input = (await screen.findByRole('textbox', {
      name: 'imageParseFormulaSource',
    })) as HTMLTextAreaElement;

    input.focus();
    input.setSelectionRange(3, 3);
    await user.keyboard('X');

    expect(input).toHaveValue('abcXdef');
    expect(input.selectionStart).toBe(4);
    expect(input.selectionEnd).toBe(4);
  });

  it('非法 LaTeX 提示错误并阻止失焦保存，Escape 放弃修改', async () => {
    const source = '$$\na^2\n$$';
    const onSave = vi.fn();
    const { container } = render(<Harness initial={source} onSave={onSave} />);
    fireEvent.doubleClick(container.querySelector('.katex')!);
    const input = await screen.findByRole('textbox', { name: 'imageParseFormulaSource' });
    fireEvent.change(input, { target: { value: String.raw`\frac{` } });
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByText('imageParseFormulaInvalid')).toHaveAttribute('role', 'alert');
    fireEvent.pointerDown(screen.getByRole('button', { name: '外部' }));
    expect(input).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
    expect(screen.getByTestId('source').textContent).toBe(source);
    expect(container.querySelectorAll('.katex-display')).toHaveLength(1);
  });

  it('源码输入框中的输入法组合尚未结束时不保存或关闭', async () => {
    const onSave = vi.fn();
    const { container } = render(<Harness initial={'$$\na^2\n$$'} onSave={onSave} />);
    fireEvent.doubleClick(container.querySelector('.katex')!);
    const input = await screen.findByRole('textbox', { name: 'imageParseFormulaSource' });
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: String.raw`\text{中文}` } });
    fireEvent.pointerDown(screen.getByRole('button', { name: '外部' }));
    expect(input).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('$$\n\\text{中文}\n$$'));
  });
});
