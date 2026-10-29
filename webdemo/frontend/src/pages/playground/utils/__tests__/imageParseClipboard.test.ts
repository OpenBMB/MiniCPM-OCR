/**
 * Unit tests for table copy: HTML and TSV must both be written —
 * Feishu and Word restore a table from HTML, Excel splits columns from TSV; missing either one degrades to plain text.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const copyText = vi.hoisted(() => vi.fn(async () => true));

vi.mock('../copyText', () => ({ copyText }));

import {
  copyImageParseRegion,
  copyImageParseTable,
  imageParseCopyRegionMarkdown,
} from '../imageParseClipboard';

const TABLE = '| 项目 | 金额 |\n| --- | --- |\n| 差旅 | 1,200 |';
const TSV = '项目\t金额\n差旅\t1,200';

class FakeClipboardItem {
  constructor(readonly entries: Record<string, Blob>) {}
}

function stubClipboard(write: (items: unknown[]) => Promise<void>) {
  vi.stubGlobal('ClipboardItem', FakeClipboardItem);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { write: vi.fn(write), writeText: vi.fn(async () => undefined) },
  });
}

describe('copyImageParseTable', () => {
  beforeEach(() => {
    copyText.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('没有表格时不写剪贴板', async () => {
    stubClipboard(async () => undefined);
    await expect(copyImageParseTable('# 标题\n正文')).resolves.toBe(false);
    expect(navigator.clipboard.write).not.toHaveBeenCalled();
    expect(copyText).not.toHaveBeenCalled();
  });

  it('同时写入 HTML 与 TSV 两种格式', async () => {
    const items: FakeClipboardItem[] = [];
    stubClipboard(async (list) => {
      items.push(...(list as FakeClipboardItem[]));
    });

    await expect(copyImageParseTable(TABLE)).resolves.toBe(true);

    expect(items).toHaveLength(1);
    const entries = items[0].entries;
    expect(Object.keys(entries).sort()).toEqual(['text/html', 'text/plain']);
    await expect(entries['text/html'].text()).resolves.toBe(
      '<table><tbody><tr><td>项目</td><td>金额</td></tr>' +
        '<tr><td>差旅</td><td>1,200</td></tr></tbody></table>',
    );
    await expect(entries['text/plain'].text()).resolves.toBe(TSV);
    expect(copyText).not.toHaveBeenCalled();
  });

  it('多格式写入被拒时退回纯 TSV', async () => {
    stubClipboard(async () => {
      throw new Error('NotAllowedError');
    });

    await expect(copyImageParseTable(TABLE)).resolves.toBe(true);
    expect(copyText).toHaveBeenCalledWith(TSV);
  });

  it('浏览器不支持多格式写入时退回纯 TSV', async () => {
    vi.stubGlobal('ClipboardItem', undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    });

    await expect(copyImageParseTable(TABLE)).resolves.toBe(true);
    expect(copyText).toHaveBeenCalledWith(TSV);
  });
});

describe('copyImageParseRegion', () => {
  it('普通区域复制时去掉 Markdown 标记', async () => {
    await expect(copyImageParseRegion('**识别结果**')).resolves.toBe(true);
    expect(copyText).toHaveBeenCalledWith('识别结果');
  });

  it('行内公式复制时保留美元定界符', async () => {
    await expect(copyImageParseRegion('未归一化优势 $A_{i}$ ，任务 $B$')).resolves.toBe(true);
    expect(copyText).toHaveBeenCalledWith('未归一化优势 $A_{i}$ ，任务 $B$');
  });

  it('块级公式复制时保留双美元定界符', async () => {
    await expect(copyImageParseRegion('$$\na^2\n$$')).resolves.toBe(true);
    expect(copyText).toHaveBeenCalledWith('$$\na^2\n$$');
  });

  it('落在行间公式内部的片段补回 $$，粘在一起的多段各自成块', async () => {
    const source = '前文\n\n$$\nE=P$$ $$=0$$ $$\\Rightarrow F\n$$\n';
    const start = source.indexOf('E=P');
    const end = source.indexOf('\\Rightarrow F') + '\\Rightarrow F'.length;
    const region = imageParseCopyRegionMarkdown(source, { start, end });
    expect(region).toBe('$$\nE=P\n$$\n\n$$\n=0\n$$\n\n$$\n\\Rightarrow F\n$$');
    await expect(copyImageParseRegion(region)).resolves.toBe(true);
    expect(copyText).toHaveBeenCalledWith('$$\nE=P\n$$\n\n$$\n=0\n$$\n\n$$\n\\Rightarrow F\n$$');
  });
});
