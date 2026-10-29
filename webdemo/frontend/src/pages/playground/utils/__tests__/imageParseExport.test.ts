import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createImageParseExport,
  imageParseExportFileName,
  saveImageParseExport,
} from '../imageParseExport';
import { imageParseBlockId } from '../imageParseBlocks';
import type { ImageParseLayoutBlock } from '../imageParseSample';

const block: ImageParseLayoutBlock = {
  id: 'heading',
  kind: 'heading',
  x: 0.1,
  y: 0.1,
  w: 0.8,
  h: 0.1,
  text: '原始标题',
  markdown: '# 原始标题',
  confidence: 0.95,
  markdownStart: 0,
  markdownEnd: 6,
};

function readText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('OCR 下载文件', () => {
  it.each([
    ['扫描件.png', 'markdown', undefined, '扫描件.md'],
    ['report.v2.jpg', 'json', undefined, 'report.v2.json'],
    ['合同.pdf', 'word', 2, '合同-page-2.docx'],
    [undefined, 'word', undefined, 'image-parse.docx'],
    ['   ', 'json', undefined, 'image-parse.json'],
  ] as const)('根据原文件名和格式生成下载名', (name, format, page, expected) => {
    expect(imageParseExportFileName(name, format, page)).toBe(expected);
  });

  it('Markdown 保留用户草稿与 Unicode 文本', async () => {
    const markdown = '# 修改后的标题\n\n表格与公式 $x^2$';
    const blob = await createImageParseExport('markdown', { markdown, blocks: [] });
    expect(blob.type).toBe('text/markdown;charset=utf-8');
    expect(await readText(blob)).toBe(markdown);
  });

  it('JSON 保留当前正文、块坐标和置信度，不导出附带的敏感字段', async () => {
    const markdown = '# 修改后的标题';
    const contaminated = { ...block, token: 'not-for-export', apiKey: 'not-for-export' };
    const blob = await createImageParseExport('json', {
      markdown,
      blocks: [contaminated],
      ranges: new Map([[imageParseBlockId(block, 0), { start: 0, end: markdown.length }]]),
      edited: true,
    });
    expect(blob.type).toBe('application/json;charset=utf-8');
    const json = JSON.parse(await readText(blob));
    expect(json.markdown).toBe(markdown);
    expect(json.edited).toBe(true);
    expect(json.blocks[0]).toMatchObject({
      id: block.id,
      x: block.x,
      confidence: block.confidence,
      text: block.text,
      markdown,
      markdownStart: 0,
      markdownEnd: markdown.length,
    });
    expect(json.blocks[0]).not.toHaveProperty('token');
    expect(json.blocks[0]).not.toHaveProperty('apiKey');
    expect(block.markdown).toBe('# 原始标题');
  });

  it('编辑使定位失效时删除旧偏移，不伪造未知置信度', async () => {
    const blob = await createImageParseExport('json', {
      markdown: '# 完全替换正文',
      blocks: [{ ...block, confidence: null }],
      ranges: new Map(),
    });
    const json = JSON.parse(await readText(blob));
    expect(json.blocks[0].confidence).toBeNull();
    expect(json.blocks[0]).not.toHaveProperty('markdownStart');
    expect(json.blocks[0]).not.toHaveProperty('markdownEnd');
  });

  it('下载链接暂时挂载，并在浏览器开始消费文件后释放 URL', () => {
    vi.useFakeTimers();
    const revokeObjectURL = vi.fn();
    const createObjectURL = vi.fn(() => 'blob:local-export');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.isConnected).toBe(true);
      expect(this.download).toBe('识别.json');
    });
    saveImageParseExport(new Blob(['{}']), '识别.json');
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:local-export');
  });
});
