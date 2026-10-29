import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MarkdownRenderer } from '@/pages/playground/components/MarkdownRenderer';
import { imageParseBlockRanges } from '@/pages/playground/utils/imageParseBlocks';
import { imageParseSealDisplayResult } from '@/pages/playground/utils/imageParseSealDisplay';
import { adaptImageParseV2 } from '../imageParseV2';
import { validateImageParseSdkResult } from '../imageParseSdk';

vi.mock('../request', () => ({ mapRequest: vi.fn() }));

const FOOTER = '东洲评报字【2026】第1500号-16-';

interface BlockInput {
  content: string;
  label?: string;
  status?: string;
}

/** Build a service response whose body and structured blocks disagree, covering the real adapt and render path. */
function adapt(content: string, inputs: BlockInput[]) {
  return adaptImageParseV2({
    choices: [{ message: { content } }],
    ocr: {
      request_id: 'compatibility-test',
      mode: 'stp',
      image_width: 1653,
      image_height: 2337,
      blocks: inputs.map((block, order) => ({
        order,
        label: block.label ?? 'text',
        status: block.status ?? 'ok',
        content: block.content,
        bbox: [10, order * 20, 100, order * 20 + 10],
        score: 0.99,
      })),
    },
  });
}

describe('OCR 正文与结构化块的兼容', () => {
  it('补齐截图中的遗漏页脚，并让预览与原图定位使用同一份内容', () => {
    const result = adapt('## （3）资产管理业务', [
      { content: '（3）资产管理业务', label: 'paragraph_title' },
      { content: FOOTER, label: 'footer' },
    ]);
    expect(result.markdown).toBe(`## （3）资产管理业务\n\n${FOOTER}`);
    const ranges = imageParseBlockRanges(result.markdown, result.blocks);
    expect(result.markdown.slice(ranges.get('ocr-1')!.start, ranges.get('ocr-1')!.end)).toBe(
      FOOTER,
    );
    expect(validateImageParseSdkResult(result)).toBe(result);
    render(<MarkdownRenderer content={result.markdown} variant="document" />);
    expect(screen.getByText(FOOTER)).toBeVisible();
  });

  it('按服务阅读顺序补齐页眉和中间段落，不拆开 Markdown 标题', () => {
    const result = adapt('# 标题\n\n## 后续标题\n\n结尾', [
      { content: '报告页眉', label: 'header' },
      { content: '标题', label: 'title' },
      { content: '遗漏段落' },
      { content: '后续标题', label: 'paragraph_title' },
      { content: '结尾' },
    ]);
    expect(result.markdown).toBe('报告页眉\n\n# 标题\n\n遗漏段落\n\n## 后续标题\n\n结尾');
    expect(imageParseBlockRanges(result.markdown, result.blocks).size).toBe(5);
  });

  it('空聚合正文仍可从成功识别的块恢复内容', () => {
    const result = adapt('', [{ content: '正文' }, { content: FOOTER, label: 'footer' }]);
    expect(result.markdown).toBe(`正文\n\n${FOOTER}`);
    expect(validateImageParseSdkResult(result)).toBe(result);
  });

  it('相同内容的不同识别块分别定位，仅补齐缺少的那一次', () => {
    const result = adapt('重复文字\n\n结尾', [
      { content: '重复文字' },
      { content: '重复文字' },
      { content: '结尾' },
    ]);
    expect(result.markdown).toBe('重复文字\n\n重复文字\n\n结尾');
    const ranges = imageParseBlockRanges(result.markdown, result.blocks);
    expect(ranges.get('ocr-0')).not.toEqual(ranges.get('ocr-1'));
    expect(ranges.size).toBe(3);
  });

  it('正文里的加粗和换行差异不会被误判为遗漏', () => {
    const source = '# 标题\n\n证券**交易**业务\n覆盖债券、股票。\n';
    const result = adapt(source, [
      { content: '标题', label: 'title' },
      { content: '证券交易业务覆盖债券、股票。' },
    ]);
    expect(result.markdown).toBe(source);
    expect(imageParseBlockRanges(result.markdown, result.blocks).size).toBe(2);
  });

  it.each([
    ['##', '1. Computational Tool'],
    ['###', '2. Computational Tool'],
    ['##', '32. Demo'],
  ])('编号标题 %s %s 不按有序列表丢掉编号，保留完整定位范围', (marker, title) => {
    const source = `${marker} ${title}\n\n01A`;
    const result = adapt(source, [
      { content: title, label: 'paragraph_title' },
      { content: '01A' },
    ]);
    const ranges = imageParseBlockRanges(result.markdown, result.blocks);
    expect(result.markdown).toBe(source);
    expect(result.blocks[0].text).toBe(title);
    expect(result.blocks[0].markdown).toBe(`${marker} ${title}`);
    expect(ranges.get('ocr-0')).toEqual({ start: 0, end: `${marker} ${title}`.length });
    const { container } = render(
      <MarkdownRenderer
        content={result.markdown}
        variant="document"
        editableBlocks
        linkedRanges={[...ranges].map(([id, range]) => ({ id, range }))}
      />,
    );
    expect(container.querySelector(marker === '##' ? 'h2' : 'h3')).toHaveAttribute(
      'data-ocr-block-id',
      'ocr-0',
    );
  });

  it('保留 HTML 合并表格、GFM 表格和公式，不重复补入已有块', () => {
    const table = '<table><tr><td colspan="2">合计</td></tr></table>';
    const gfm = '| 项目 | 数量 |\n| --- | --- |\n| 实测 | 7 |';
    const formula = '$$\nx^2 + y^2\n$$';
    const source = `${table}\n\n${gfm}\n\n${formula}`;
    const result = adapt(source, [
      { content: table, label: 'table' },
      { content: gfm, label: 'table' },
      { content: formula, label: 'formula' },
      { content: FOOTER, label: 'footer' },
    ]);
    expect(result.markdown).toBe(`${source}\n\n${FOOTER}`);
  });

  it('裸 LaTeX 识别块已经对应显示公式时不再追加第二份原文', () => {
    const formula = String.raw`failstone(p,q)=\left\{\begin{array}{ll}1&(p=q)\\ 1+failstone(p-q,p)&(p>q)\end{array}\right.`;
    const source = `$$\n${formula}\n$$`;
    const result = adapt(source, [{ content: formula, label: 'display_formula' }]);

    expect(result.markdown).toBe(source);
    expect(result.blocks[0].markdown).toBe(source);
    expect(result.blocks[0].markdownStart).toBe(0);
    expect(result.blocks[0].markdownEnd).toBe(source.length);
    const { container } = render(<MarkdownRenderer content={result.markdown} variant="document" />);
    expect(container.querySelectorAll('.katex-display')).toHaveLength(1);
  });

  it('服务同时返回显示公式和裸 LaTeX 时只保留一份，后文映射同步更新', () => {
    const formula = String.raw`\frac{p}{q}`;
    const display = `$$\n${formula}\n$$`;
    const result = adapt(`${display}\n\n${formula}\n\n后文`, [
      { content: formula, label: 'display_formula' },
      { content: '后文' },
    ]);
    expect(result.markdown).toBe(`${display}\n\n后文`);
    expect(result.blocks[0].markdown).toBe(display);
    expect(result.blocks[0].markdownStart).toBe(0);
    const ranges = imageParseBlockRanges(result.markdown, result.blocks);
    expect(ranges.get('ocr-1')?.start).toBe(display.length + 2);
    expect(validateImageParseSdkResult(result)).toBe(result);
  });

  it('补齐表格前后的段落，不向表格行内插入文字', () => {
    const table = '| 项目 | 数量 |\n| --- | --- |\n| 实测 | 7 |';
    const result = adapt(`# 标题\n\n${table}\n\n结尾`, [
      { content: '标题', label: 'title' },
      { content: '表格说明' },
      { content: table, label: 'table' },
      { content: '表格备注' },
      { content: '结尾' },
    ]);
    expect(result.markdown).toBe(`# 标题\n\n表格说明\n\n${table}\n\n表格备注\n\n结尾`);
  });

  it('失败、跳过、空白与图片类块不被补入正文，图片占位符保持不变', () => {
    const source = '正文\n\n![image]()';
    const result = adapt(source, [
      { content: '正文' },
      { content: '失败文字', status: 'missing_crop' },
      { content: '跳过文字', status: 'skipped_no_vlm' },
      { content: '  \n ' },
      { content: '图片说明', label: 'image' },
      { content: '图表说明', label: 'chart' },
      { content: '印章文字', label: 'seal' },
      { content: '页眉图', label: 'header_image' },
    ]);
    expect(result.markdown).toBe(source);
  });

  it('图表识别文字保持 Markdown 定位，关闭图表展示时可替换为原图占位符', () => {
    const source = '正文\n\n![image]()\n\n图表识别文字\n\n结尾';
    const result = adapt(source, [
      { content: '正文' },
      { content: '', label: 'image', status: 'skipped_no_vlm' },
      { content: '图表识别文字', label: 'chart' },
      { content: '结尾' },
    ]);
    const ranges = imageParseBlockRanges(result.markdown, result.blocks);
    const placeholderStart = source.indexOf('![image]()');
    const chartStart = source.indexOf('图表识别文字');

    expect(result.markdown).toBe(source);
    expect(ranges.get('ocr-1')).toEqual({
      start: placeholderStart,
      end: placeholderStart + '![image]()'.length,
    });
    expect(ranges.get('ocr-2')).toEqual({
      start: chartStart,
      end: chartStart + '图表识别文字'.length,
    });

    const displayed = imageParseSealDisplayResult(result, true, false);
    expect(displayed.markdown).toBe('正文\n\n![image]()\n\n![image]()\n\n结尾');
    expect(displayed.blocks[2]).toMatchObject({
      markdown: '![image]()',
      markdownStart: '正文\n\n![image]()\n\n'.length,
      markdownEnd: '正文\n\n![image]()\n\n![image]()'.length,
    });
  });

  it('没有结构化块时原样保留服务正文', () => {
    const source = '# 标题\n\n原始正文\n';
    expect(adapt(source, []).markdown).toBe(source);
  });

  it('一个识别块包含多个 Markdown 段落时不会重复补入', () => {
    const source = '# 标题\n\n首段\n\n次段';
    const result = adapt(source, [
      { content: '标题', label: 'title' },
      { content: '首段\n\n次段' },
      { content: FOOTER, label: 'footer' },
    ]);
    expect(result.markdown).toBe(`${source}\n\n${FOOTER}`);
    expect(imageParseBlockRanges(result.markdown, result.blocks).size).toBe(3);
  });

  it('图片占位符也作为阅读顺序锚点，补入文字不会越过原图块', () => {
    const result = adapt('# 标题\n\n![image]()\n\n结尾', [
      { content: '标题', label: 'title' },
      { content: '图片之前的说明' },
      { content: '', label: 'image', status: 'skipped_no_vlm' },
      { content: '图片之后的说明' },
      { content: '结尾' },
    ]);
    expect(result.markdown).toBe(
      '# 标题\n\n图片之前的说明\n\n![image]()\n\n图片之后的说明\n\n结尾',
    );
  });

  it('页码不会命中年份里的数字，已有的 Remark 不会再插入参考文献中间', () => {
    const remark = 'Remark 2. We use mainly the case r = 4.';
    const ref1 = '[1] J. Barrionuevo, Math. Res. Lett. 25 (2018), 1369–1388.';
    const ref2 = '[2] Á. Bényi, Comm. Partial Differential Equations 28 (2003), 1161–1181.';
    const source = `${remark}\n\n## REFERENCES\n\n${ref1}\n\n${ref2}`;
    const result = adapt(source, [
      { content: '20', label: 'number' },
      { content: remark },
      { content: 'REFERENCES', label: 'paragraph_title' },
      { content: ref1, label: 'reference_content' },
      { content: ref2, label: 'reference_content' },
    ]);
    expect(result.markdown.split('Remark 2').length - 1).toBe(1);
    expect(result.markdown.indexOf(remark)).toBeLessThan(result.markdown.indexOf('[1]'));
    expect(result.markdown.indexOf('[2]')).toBeGreaterThan(result.markdown.indexOf('[1]'));
    expect(result.markdown).toContain('(2018)');
    const ranges = imageParseBlockRanges(result.markdown, result.blocks);
    expect(result.markdown.slice(ranges.get('ocr-1')!.start, ranges.get('ocr-1')!.end)).toBe(
      remark,
    );
  });

  it('说明里的 image 不会抢走图片占位符，段落和图片各自对上原图框', () => {
    const paragraph =
      'The test image, the answer key, and what each model returned. A $\\checkmark$ is a pass.';
    const source = `${paragraph}\n\n![image]()`;
    const result = adapt(source, [
      { content: paragraph },
      { content: '', label: 'image', status: 'skipped_no_vlm' },
    ]);
    const ranges = imageParseBlockRanges(result.markdown, result.blocks);
    expect(result.markdown.slice(ranges.get('ocr-0')!.start, ranges.get('ocr-0')!.end)).toBe(
      paragraph,
    );
    expect(result.markdown.slice(ranges.get('ocr-1')!.start, ranges.get('ocr-1')!.end)).toBe(
      '![image]()',
    );
  });
});
