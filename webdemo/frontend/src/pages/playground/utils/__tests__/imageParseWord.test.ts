import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { createImageParseWordBlob } from '../imageParseWord';

async function documentXml(markdown: string) {
  const blob = await createImageParseWordBlob(markdown);
  expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
  const zip = await JSZip.loadAsync(bytes);
  expect(zip.file('[Content_Types].xml')).not.toBeNull();
  const xml = await zip.file('word/document.xml')!.async('string');
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  expect(document.querySelector('parsererror')).toBeNull();
  return { document, xml, zip };
}

describe('OCR Word 导出', () => {
  it('生成真实 DOCX，保留标题、中文、加粗、列表、换行与公式内容', async () => {
    const { document, xml } = await documentXml(
      '# 修改后的标题\n\n正文 **重点** 与 *斜体* 以及 $x^2$。\n\n' +
        '- 清单项目\n- [x] 已完成\n\n3. 编号项\n\n```text\n第一行\n第二行\n```\n\n$$\ny=x+1\n$$',
    );
    expect(document.documentElement.textContent).toContain('修改后的标题');
    expect(document.documentElement.textContent).toContain('重点');
    expect(document.documentElement.textContent).toContain('清单项目');
    expect(document.documentElement.textContent).toContain('已完成');
    expect(document.documentElement.textContent).toContain('x^2');
    expect(document.documentElement.textContent).toContain('y=x+1');
    expect(xml).toContain('w:val="Heading1"');
    expect(xml).toContain('<w:b');
    expect(xml).toContain('<w:i');
    expect(xml).toContain('<w:numPr>');
    expect(xml).toContain('<w:br');
  });

  it('GFM 表格导出为可编辑 Word 表格而非 Markdown 源码', async () => {
    const { document } = await documentXml('| 名称 | 数量 |\n| --- | --- |\n| 文档 | 12 |');
    expect(document.querySelectorAll('tbl')).toHaveLength(1);
    expect(document.querySelectorAll('tr')).toHaveLength(2);
    expect(document.querySelectorAll('tc')).toHaveLength(4);
    expect(document.documentElement.textContent).toContain('文档');
    expect(document.documentElement.textContent).not.toContain('| ---');
  });

  it('OCR HTML 表格保留内容与合并单元格，忽略脚本与事件属性', async () => {
    const { document, xml } = await documentXml(
      '<table><tr><th colspan="2">合并标题</th></tr>' +
        '<tr><td rowspan="2">合并行</td><td>甲</td></tr><tr><td>乙</td></tr></table>\n\n' +
        '<script>not-for-export</script>',
    );
    expect(document.querySelectorAll('tbl')).toHaveLength(1);
    expect(document.documentElement.textContent).toContain('合并标题');
    expect(document.documentElement.textContent).toContain('甲');
    expect(document.documentElement.textContent).toContain('乙');
    expect(xml).toContain('<w:gridSpan w:val="2"');
    expect(xml).toContain('<w:vMerge');
    expect(xml).not.toContain('not-for-export');
  });

  it('安全链接保持可点击，危险协议不写入文档关系', async () => {
    const { zip, document } = await documentXml(
      '[文档](https://example.test/docs)\n\n[危险](javascript:alert%281%29)',
    );
    const rels = await zip.file('word/_rels/document.xml.rels')!.async('string');
    expect(rels).toContain('https://example.test/docs');
    expect(rels).not.toContain('javascript:');
    expect(document.documentElement.textContent).toContain('危险');
  });

  it('HTML 有序列表保留起始编号、嵌套层级与独立段落', async () => {
    const { document, zip } = await documentXml(
      '<ol start="3"><li>first<ul><li>child</li></ul></li><li>second</li></ol>',
    );
    const paragraphs = [...document.querySelectorAll('body > p')];
    expect(paragraphs.map((paragraph) => paragraph.textContent)).toEqual([
      'first',
      'child',
      'second',
    ]);
    const numbering = await zip.file('word/numbering.xml')!.async('string');
    expect(numbering).toContain('w:start w:val="3"');
    expect(paragraphs[1].querySelector('ilvl')?.getAttribute('w:val')).toBe('1');
  });

  it('HTML 表格单元格内的多段正文不会拼接', async () => {
    const { document } = await documentXml('<table><tr><td><p>甲</p><p>乙</p></td></tr></table>');
    expect(
      [...document.querySelectorAll('tc > p')].map((paragraph) => paragraph.textContent),
    ).toEqual(['甲', '乙']);
  });

  it('Markdown 内嵌 HTML 换行在正文和 GFM 单元格中保留', async () => {
    const { document } = await documentXml(
      'first<br>second\n\n| 内容 |\n| --- |\n| 第一行<br>第二行 |',
    );
    expect(document.querySelectorAll('br')).toHaveLength(2);
  });

  it.each([
    '&lt;br&gt;',
    '&lt;br /&gt;',
    '&#60;BR&#62;',
    '&#x3c;br/&#x3e;',
    '&amp;lt;br&amp;gt;',
    '&amp;#60;BR&amp;#62;',
  ])('Word 将正文与两种表格中的 %s 导出为真实换行', async (lineBreak) => {
    const { document } = await documentXml(
      `正文${lineBreak}续行\n\n` +
        `<table><tr><td>第一行${lineBreak}第二行</td></tr></table>\n\n` +
        `| 内容 |\n| --- |\n| 上一行${lineBreak}下一行 |`,
    );
    expect(document.querySelectorAll('br')).toHaveLength(3);
    expect(document.querySelectorAll('tbl')).toHaveLength(2);
    expect(document.documentElement.textContent).not.toContain('<br');
  });

  it('Word 保留代码示例与其他转义 HTML，换行转换不扩展到代码', async () => {
    const { document } = await documentXml(
      '正文&lt;br&gt;续行 `代码&lt;br&gt;`\n\n' +
        '```html\n代码&lt;br&gt;\n```\n\n' +
        '<table><tr><td>甲&lt;br&gt;乙 <code>示例&lt;br&gt;</code> &lt;img src=x onerror=alert(1)&gt;</td></tr></table>',
    );
    expect(document.querySelectorAll('br')).toHaveLength(2);
    expect(document.documentElement.textContent).toContain('代码&lt;br&gt;');
    expect(document.documentElement.textContent).toContain('示例<br>');
    expect(document.documentElement.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('脚注引用和正文不因导出而遗漏', async () => {
    const { xml, zip } = await documentXml('正文[^a]\n\n[^a]: 脚注说明');
    expect(xml).toContain('<w:footnoteReference');
    const footnotes = await zip.file('word/footnotes.xml')!.async('string');
    expect(footnotes).toContain('脚注说明');
  });
});
