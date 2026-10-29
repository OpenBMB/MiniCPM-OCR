import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { imageParseEditorExtensions } from '../imageParseEditorExtensions';
import { prepareImageParseEditorSource } from '../imageParseEditorSource';

function editorFor(source: string) {
  return new Editor({
    element: document.createElement('div'),
    extensions: imageParseEditorExtensions(),
    content: prepareImageParseEditorSource(source),
    contentType: 'markdown',
  });
}

describe('OCR 复杂公式导入导出', () => {
  it.each([
    String.raw`\frac{1+\frac{a}{b}}{\sqrt[3]{1+x^2}}`,
    String.raw`\int_0^\infty e^{-x^2}\,dx=\frac{\sqrt{\pi}}{2}`,
    String.raw`\begin{aligned}A&=\begin{pmatrix}a&b\\c&d\end{pmatrix}\\\det A&=ad-bc\end{aligned}`,
    String.raw`f(x)=\begin{cases}x^2&x>0\\0&x\le0\end{cases}`,
    String.raw`\underbrace{a+b+c}_{3\text{ 项}}=\overline{x}\pm\hat{\alpha}`,
  ])('表格中 %s 的四种定界符可无损往返', (latex) => {
    const escaped = latex.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const formulas = [`$${escaped}$`, `\\(${escaped}\\)`, `$$${escaped}$$`, `\\[${escaped}\\]`];
    const editor = editorFor(
      `<table><tr>${formulas.map((formula) => `<td>${formula}</td>`).join('')}</tr></table>`,
    );
    try {
      expect(editor.view.dom.querySelectorAll('[data-type="inline-math"]')).toHaveLength(2);
      expect(editor.view.dom.querySelectorAll('[data-type="block-math"]')).toHaveLength(2);
      expect(editor.view.dom.querySelectorAll('.katex-error')).toHaveLength(0);
      const imported = editorFor(editor.getMarkdown());
      try {
        expect(imported.getJSON()).toEqual(editor.getJSON());
      } finally {
        imported.destroy();
      }
    } finally {
      editor.destroy();
    }
  });

  it.each([
    String.raw`\text{cost \$5}`,
    String.raw`\verb|$a$|`,
    String.raw`\verb|$$a$$|`,
  ])('普通文档中含美元符的行内公式 %s 可无损往返', (latex) => {
    const editor = editorFor(`前\\(${latex}\\)后\n\n\\(b^2\\)`);
    try {
      const math = editor.view.dom.querySelectorAll('[data-type="inline-math"]');
      expect(math).toHaveLength(2);
      expect(math[0]).toHaveAttribute('data-latex', latex);
      expect(editor.view.dom.querySelectorAll('.katex-error')).toHaveLength(0);
      const imported = editorFor(editor.getMarkdown());
      try {
        expect(imported.getJSON()).toEqual(editor.getJSON());
      } finally {
        imported.destroy();
      }
    } finally {
      editor.destroy();
    }
  });

  it.each([
    String.raw`\text{cost \$5}`,
    String.raw`\begin{aligned}x&=\frac{a}{b}\\y&=\sqrt{x}\end{aligned}`,
    String.raw`E=mc^2\tag{1}`,
    String.raw`\unsupportedcommand{x}`,
  ])('原生块级公式 %s 在导入导出后完整保留', (latex) => {
    const editor = editorFor(`前言\n\n\\[${latex}\\]\n\n后文`);
    try {
      expect(editor.view.dom.querySelectorAll('[data-type="block-math"]')).toHaveLength(1);
      expect(editor.view.dom.querySelector('[data-type="block-math"]')).toHaveAttribute(
        'data-latex',
        latex,
      );
      const imported = editorFor(editor.getMarkdown());
      try {
        expect(imported.getJSON()).toEqual(editor.getJSON());
      } finally {
        imported.destroy();
      }
    } finally {
      editor.destroy();
    }
  });
});
