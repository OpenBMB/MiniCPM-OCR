import { useState } from 'react';
import type { Editor } from '@tiptap/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { IMAGE_PARSE_CONSTANTS_TABLE } from '../../utils/__tests__/fixtures/imageParseConstantsTable';
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
    </>
  );
}

function formula(container: HTMLElement, latex: string) {
  return [...container.querySelectorAll('annotation')]
    .find((node) => node.textContent === latex)!
    .closest('.katex')!;
}

describe('OCR 公式原位编辑', () => {
  it('should edit the double-clicked formula inside its merged HTML table and render on blur', async () => {
    const onSave = vi.fn();
    const { container } = render(<Harness initial={IMAGE_PARSE_CONSTANTS_TABLE} onSave={onSave} />);
    const target = formula(container, 'N_{A}');
    fireEvent.click(target);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.doubleClick(target);
    const input = await screen.findByRole('textbox', { name: 'imageParseFormulaSource' });
    expect(input.closest('td')).not.toBeNull();
    expect(input).toHaveValue('N_{A}');
    expect(container.querySelectorAll('.tiptap textarea')).toHaveLength(1);
    expect(
      container.querySelector('textarea')?.closest('[data-type="inline-math"]'),
    ).not.toBeNull();
    fireEvent.change(input, { target: { value: 'N_{B}' } });
    const editor = screen.getByRole('textbox', { name: 'imageParseInlineEditor' });
    fireEvent.blur(input, { relatedTarget: editor });
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'imageParseFormulaSource' })).toBeNull(),
    );
    expect(container.querySelector('.tiptap td[rowspan="2"]')).not.toBeNull();
    expect(container.querySelector('.tiptap td[colspan="2"]')).not.toBeNull();
    expect(formula(container, 'N_{B}')).toBeInTheDocument();
    expect(container.querySelector('img:not(.ProseMirror-separator), canvas')).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByRole('button', { name: '外部' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(container.querySelector('td[rowspan="2"]')).not.toBeNull();
    expect(container.querySelector('td[colspan="2"]')).not.toBeNull();
    expect(formula(container, 'N_{B}')).toBeInTheDocument();
  });

  it('should keep rendered formulas until double-clicked and preserve source on an unchanged session', async () => {
    const source = '正文 $a^2$ 与 $b^2$。';
    const onSave = vi.fn();
    const { container } = render(<Harness initial={source} onSave={onSave} />);
    fireEvent.doubleClick(container.querySelector('p')!);
    const editor = await screen.findByRole('textbox', { name: 'imageParseInlineEditor' });
    await waitFor(() => expect(editor).toHaveFocus());
    expect(screen.queryByRole('textbox', { name: 'imageParseFormulaSource' })).toBeNull();
    fireEvent.click(formula(container, 'b^2'));
    expect(screen.queryByRole('textbox', { name: 'imageParseFormulaSource' })).toBeNull();
    fireEvent.doubleClick(formula(container, 'b^2'));
    const input = await screen.findByRole('textbox', { name: 'imageParseFormulaSource' });
    expect(input).toHaveValue('b^2');
    fireEvent.blur(input, { relatedTarget: editor });
    fireEvent.doubleClick(formula(container, 'a^2'));
    expect(await screen.findByRole('textbox', { name: 'imageParseFormulaSource' })).toHaveValue(
      'a^2',
    );
    fireEvent.pointerDown(screen.getByRole('button', { name: '外部' }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('should undo and redo in place without changing adjacent formulas', async () => {
    const { container } = render(<Harness initial="正文 $a^2$ 与 $b^2$。" onSave={vi.fn()} />);
    fireEvent.doubleClick(formula(container, 'a^2'));
    const input = await screen.findByRole('textbox', { name: 'imageParseFormulaSource' });
    fireEvent.change(input, { target: { value: 'a^3' } });
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(input).toHaveValue('a^2'));
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(input).toHaveValue('a^3'));
    const editor = screen.getByRole('textbox', { name: 'imageParseInlineEditor' });
    const instance = (editor as HTMLElement & { editor: Editor }).editor;
    expect(instance.getText()).toBe('正文  与 。');
    expect(formula(container, 'b^2')).toBeInTheDocument();
  });

  it('should edit only the double-clicked occurrence when formulas repeat', async () => {
    const onSave = vi.fn();
    const { container } = render(
      <Harness initial="第一处 $a^2$ 与第二处 $a^2$。" onSave={onSave} />,
    );
    fireEvent.doubleClick(container.querySelectorAll('.katex')[1]);
    const input = await screen.findByRole('textbox', { name: 'imageParseFormulaSource' });
    expect(container.querySelectorAll('textarea')).toHaveLength(1);
    fireEvent.change(input, { target: { value: 'a^3' } });
    fireEvent.pointerDown(screen.getByRole('button', { name: '外部' }));
    expect(onSave).toHaveBeenCalledWith('第一处 $a^2$ 与第二处 $a^3$。');
  });
});
