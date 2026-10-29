import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { imageParseEditorExtensions } from '../imageParseEditorExtensions';
import { prepareImageParseEditorSource } from '../imageParseEditorSource';
import { IMAGE_PARSE_CONSTANTS_TABLE } from './fixtures/imageParseConstantsTable';

function editorFor(source: string) {
  return new Editor({
    element: document.createElement('div'),
    extensions: imageParseEditorExtensions(),
    content: prepareImageParseEditorSource(source),
    contentType: 'markdown',
  });
}

describe('OCR HTML 表格公式编辑导入', () => {
  it('物理常数表格使用真实单元格和公式，编辑导出后仍保留完整行列与合并关系', () => {
    const editor = editorFor(IMAGE_PARSE_CONSTANTS_TABLE);
    try {
      expect(editor.view.dom.querySelectorAll('tr')).toHaveLength(8);
      expect(editor.view.dom.querySelectorAll('td[rowspan="2"]')).toHaveLength(3);
      expect(editor.view.dom.querySelectorAll('td[colspan="2"]')).toHaveLength(1);
      expect(editor.view.dom.querySelectorAll('[data-type="inline-math"]')).toHaveLength(17);
      expect(editor.view.dom.querySelector('img:not(.ProseMirror-separator), canvas')).toBeNull();
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

  it('单元格原始 LaTeX 导入为数学节点，导出后再次导入不丢公式和合并关系', () => {
    const source = String.raw`<table><tr><th colspan="2">单位 $N_A$</th></tr><tr><td rowspan="2">$\lambda_c=\frac{h}{m_a c}$</td><td>\(10^{-15}\)</td></tr><tr><td>$$
\begin{pmatrix}a&b\\c&d\end{pmatrix}
$$</td></tr></table>`;
    const editor = editorFor(source);
    try {
      expect(editor.view.dom.querySelectorAll('[data-type="inline-math"]')).toHaveLength(3);
      expect(editor.view.dom.querySelectorAll('[data-type="block-math"]')).toHaveLength(1);
      expect(editor.view.dom.querySelector('th[colspan="2"]')).not.toBeNull();
      expect(editor.view.dom.querySelector('td[rowspan="2"]')).not.toBeNull();
      const output = editor.getMarkdown();
      expect(output).toContain('<code class="math-inline">N_A</code>');
      expect(output).toContain('class="math-display"');
      const imported = editorFor(output);
      try {
        expect(imported.getJSON()).toEqual(editor.getJSON());
      } finally {
        imported.destroy();
      }
    } finally {
      editor.destroy();
    }
  });

  it('不将代码、属性、转义 HTML 和普通金额导入为数学节点', () => {
    const source = String.raw`<table><tr><td title="$attribute$"><code>$x^2$</code><pre>$y^2$</pre><p>金额 $100</p>；&lt;img src=x onerror=alert(1)&gt;；$N_A$</td></tr></table>`;
    const editor = editorFor(source);
    try {
      expect(editor.view.dom.querySelectorAll('[data-type="inline-math"]')).toHaveLength(1);
      expect(editor.view.dom.querySelector('code')).toHaveTextContent('$x^2$');
      expect(editor.getText()).toContain('金额 $100');
      expect(
        editor.view.dom.querySelector('img:not(.ProseMirror-separator), [onerror]'),
      ).toBeNull();
    } finally {
      editor.destroy();
    }
  });

  it.each(['$$x^2', '$$\nx^2', '$$$\nx^2\n$$'])(
    '编辑导入和导出保留未闭合块级公式 %s',
    (formula) => {
      const source = `<table><tr><td>${formula}</td></tr></table>`;
      const editor = editorFor(source);
      try {
        expect(editor.view.dom.querySelector('[data-type="block-math"]')).toBeNull();
        expect(editor.getMarkdown()).toContain('x^2');
        expect(prepareImageParseEditorSource(source)).toBe(source);
      } finally {
        editor.destroy();
      }
    },
  );

  it.each(['$N_A$', '\\(N_A\\)', '\\[\nN_A\n\\]'])(
    'HTML 缩进中的 %s 导入后仍是数学节点',
    (formula) => {
      const editor = editorFor(`<table><tr><td>\n    ${formula}\n</td></tr></table>`);
      try {
        expect(editor.view.dom.querySelectorAll('.katex')).toHaveLength(1);
        expect(editor.view.dom.querySelector('annotation')).toHaveTextContent('N_A');
      } finally {
        editor.destroy();
      }
    },
  );

  it('公式内原生定界符不被二次规范化，代码中的定界符也保持原样', () => {
    const formula = String.raw`\verb|\(x\)|`;
    const source = `<table><tr><td>$${formula}$</td><td><code>\\(code\\)</code></td></tr></table>`;
    const editor = editorFor(source);
    try {
      expect(editor.view.dom.querySelector('[data-type="inline-math"]')).toHaveAttribute(
        'data-latex',
        formula,
      );
      expect(editor.view.dom.querySelector('td:last-child code')).toHaveTextContent(
        String.raw`\(code\)`,
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

  it.each([
    [String.raw`\(x_{&lt;br&gt;}\)`, 'x_{<br>}'],
    [String.raw`\(\verb|\[x\]|\)`, String.raw`\verb|\[x\]|`],
    [String.raw`\(\verb|\(x\)|\)`, String.raw`\verb|\(x\)|`],
    [String.raw`\(\text{cost \$5}\)`, String.raw`\text{cost \$5}`],
    [String.raw`\(\verb|$a$|\)`, String.raw`\verb|$a$|`],
  ])('原生公式 %s 的正文在导入导出后保持不变', (formula, latex) => {
    const editor = editorFor(`<table><tr><td>\n    ${formula}\n</td></tr></table>`);
    try {
      expect(editor.view.dom.querySelector('[data-type="inline-math"]')).toHaveAttribute(
        'data-latex',
        latex,
      );
      expect(editor.view.dom.querySelector('td br:not(.ProseMirror-trailingBreak)')).toBeNull();
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
