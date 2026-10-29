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

describe('Tiptap OCR 导入与导出', () => {
  it('块级公式使用显示模式，行内公式保持行内模式和原始 LaTeX', () => {
    const formula = String.raw`failstone(p,q)=\left\{\begin{array}{ll}1&(p=q)\\1+failstone(p-q,p)&(p>q)\end{array}\right.`;
    const editor = editorFor(`行内 $p+q$。\n\n$$\n${formula}\n$$`);
    try {
      const block = editor.view.dom.querySelector('[data-type="block-math"]');
      const inline = editor.view.dom.querySelector('[data-type="inline-math"]');
      expect(block?.querySelector('.katex-display')).not.toBeNull();
      expect(block?.querySelector('annotation')?.textContent).toBe(formula);
      expect(inline?.querySelector('.katex')).not.toBeNull();
      expect(inline?.querySelector('.katex-display')).toBeNull();
    } finally {
      editor.destroy();
    }
  });

  it('合并单元格、空单元格和单元格换行经导出再次导入仍完整', () => {
    const source =
      '<table><tr><th colspan="2">A &amp; B</th></tr>' +
      '<tr><td rowspan="2">第一行<br>第二行</td><td></td></tr><tr><td>100</td></tr></table>';
    const editor = editorFor(source);
    try {
      const output = editor.getMarkdown();
      expect(output).toContain('colspan="2"');
      expect(output).toContain('rowspan="2"');
      const imported = editorFor(output);
      try {
        expect(imported.getJSON()).toEqual(editor.getJSON());
        expect(imported.getText()).toContain('第二行');
      } finally {
        imported.destroy();
      }
    } finally {
      editor.destroy();
    }
  });

  it.each([
    '&lt;br&gt;',
    '&lt;br /&gt;',
    '&#60;BR&#62;',
    '&#x3c;br/&#x3e;',
    '&amp;lt;br&amp;gt;',
    '&amp;#60;BR&amp;#62;',
  ])('转义换行 %s 在正文、HTML 和 GFM 表格编辑中一致', (lineBreak) => {
    const source =
      `正文${lineBreak}续行\n\n` +
      `<table><tr><td>第一行${lineBreak}第二行</td></tr></table>\n\n` +
      `| 内容 |\n| --- |\n| 上一行${lineBreak}下一行 |`;
    const editor = editorFor(source);
    try {
      expect(editor.view.dom.querySelectorAll('br')).toHaveLength(3);
      expect(editor.getText()).not.toContain('<br');
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

  it('换行兼容不修改代码、公式、HTML 属性或其他转义标签', () => {
    const source =
      '正文&lt;br&gt;续行 `代码&lt;br&gt;`\n\n' +
      '```html\n代码&lt;br&gt;\n```\n\n' +
      '$x_{<br>}$\n\n' +
      '<table><tr><td>甲&lt;br&gt;乙 <code>示例&lt;br&gt;</code> &lt;img src=x onerror=alert(1)&gt;' +
      '<a href="https://example.test/&lt;br&gt;">链接</a></td></tr></table>';
    const editor = editorFor(source);
    try {
      expect(editor.view.dom.querySelectorAll('br:not(.ProseMirror-trailingBreak)')).toHaveLength(
        2,
      );
      expect(editor.view.dom.querySelector('pre code')?.textContent).toBe('代码&lt;br&gt;');
      expect(editor.view.dom.querySelector('td code')?.textContent).toBe('示例<br>');
      expect(editor.view.dom.querySelector('a')).toHaveAttribute(
        'href',
        'https://example.test/<br>',
      );
      expect(
        editor.view.dom.querySelector('img:not(.ProseMirror-separator), [onerror]'),
      ).toBeNull();
      expect(editor.getText()).toContain('<img src=x onerror=alert(1)>');
      const inlineMath = editor.view.dom.querySelector('[data-type="inline-math"]');
      expect(inlineMath).toHaveAttribute('data-latex', 'x_{<br>}');
    } finally {
      editor.destroy();
    }
  });

  it('GFM 对齐、转义竖线、代码、任务列表、链接和公式再次导入不丢失', () => {
    const source =
      '# 标题\n\n正文 **粗体** *斜体* ~~删除~~ [链接](https://example.com)\n\n' +
      '| 名称 | 值 |\n| :--- | ---: |\n| A\\|B | `$x$` |\n\n' +
      '- [x] 已完成\n- [ ] 未完成\n\n```js\nconst x = "<table>";\n```\n\n$a^2$\n\n$$\nb^2\n$$';
    const editor = editorFor(source);
    try {
      const imported = editorFor(editor.getMarkdown());
      try {
        expect(imported.getJSON()).toEqual(editor.getJSON());
      } finally {
        imported.destroy();
      }
      expect(editor.getJSON().content?.some((node) => node.type === 'blockMath')).toBe(true);
      expect(editor.getText()).toContain('A|B');
    } finally {
      editor.destroy();
    }
  });

  it('脚注与无法支持的 HTML 原样保留，不妨碍其他正文修改', () => {
    const source =
      '正文引用[^note]\n\n[^note]: 脚注 **原文**\n\n<details><summary>说明</summary>原始结构</details>\n\n普通段落';
    const editor = editorFor(source);
    try {
      expect(
        editor.getJSON().content?.filter((node) => node.type === 'preservedSource'),
      ).toHaveLength(3);
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, '补充');
      const output = editor.getMarkdown();
      expect(output).toContain('正文引用[^note]');
      expect(output).toContain('[^note]: 脚注 **原文**');
      expect(output).toContain('<details><summary>说明</summary>原始结构</details>');
      expect(output).toContain('普通段落补充');
    } finally {
      editor.destroy();
    }
  });

  it('粘贴 HTML 只保留 schema 允许的属性，公式禁止受信任命令', () => {
    const editor = editorFor('普通正文');
    try {
      editor.commands.setContent(
        '<p onclick="alert(1)">安全文字</p><img src="x" onerror="alert(1)"><script>alert(1)</script>',
      );
      expect(editor.getHTML()).not.toMatch(/onclick|onerror|<script/);
      expect(editor.getText()).toContain('安全文字');
    } finally {
      editor.destroy();
    }
  });

  it('引用链接、图片与不同公式定界符经导出后仍可正确导入', () => {
    const editor = editorFor(
      '## 标题\n\n[引用链接][ref] 与 ![图片](https://example.com/a.png "图示")\n\n' +
        '[ref]: https://example.com "引用"\n\n\\(a^2\\)\n\n\\[b^2\\]',
    );
    try {
      const imported = editorFor(editor.getMarkdown());
      try {
        expect(imported.getJSON()).toEqual(editor.getJSON());
      } finally {
        imported.destroy();
      }
      expect(editor.getMarkdown()).toContain('https://example.com/a.png');
      expect(editor.getJSON().content?.some((node) => node.type === 'blockMath')).toBe(true);
    } finally {
      editor.destroy();
    }
  });

  it('表格内的公式在 HTML 导出和再次导入时保留 LaTeX', () => {
    const editor = editorFor('| 项目 | 公式 |\n| --- | --- |\n| 实测 | $a^2$ |');
    try {
      const output = editor.getMarkdown();
      expect(output).toContain('<code class="math-inline">a^2</code>');
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

  it('未知 HTML 属性、注释和空图片占位符原样保留', () => {
    const source =
      '<table data-custom="value"><tr><td>100</td></tr></table>\n\n' +
      '<!-- 原文注释 -->\n\n![image]()\n\n正常正文';
    const editor = editorFor(source);
    try {
      expect(
        editor.getJSON().content?.filter((node) => node.type === 'preservedSource'),
      ).toHaveLength(3);
      const output = editor.getMarkdown();
      expect(output).toContain('data-custom="value"');
      expect(output).toContain('<!-- 原文注释 -->');
      expect(output).toContain('![image]()');
    } finally {
      editor.destroy();
    }
  });

  it('官方合并和拆分命令保留单元格文字，结果可继续导出', () => {
    const editor = editorFor('| A | B |\n| --- | --- |\n| 100 | 200 |');
    try {
      const cells: number[] = [];
      editor.state.doc.descendants((node, position) => {
        if (node.type.name === 'tableHeader') cells.push(position);
      });
      editor.commands.setCellSelection({ anchorCell: cells[0], headCell: cells[1] });
      expect(editor.commands.mergeCells()).toBe(true);
      expect(editor.getMarkdown()).toContain('colspan="2"');
      expect(editor.getText()).toContain('A');
      expect(editor.getText()).toContain('B');
      expect(editor.commands.splitCell()).toBe(true);
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
