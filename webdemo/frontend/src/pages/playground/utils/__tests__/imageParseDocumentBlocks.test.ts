import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import {
  imageParseDocumentBlocks,
  imageParseDocumentBlockMarkers,
} from '../imageParseDocumentBlocks';
import { normalizeMathDelimiters } from '../math';

describe('OCR 预览语义块映射', () => {
  it('规范化公式后仍映射原始范围，重复段落有独立范围，表格不拆分', () => {
    const source = '## 标题\n\n相同\n\n相同\n\n\\(a^2\\)\n\n| A | B |\n| --- | --- |\n| 1 | 2 |';
    const normalized = normalizeMathDelimiters(source, { detectBareMath: true });
    const blocks = imageParseDocumentBlocks(source, normalized, false);
    expect(blocks).toHaveLength(5);
    expect(blocks.map(({ start, end }) => source.slice(start, end))).toEqual([
      '## 标题',
      '相同',
      '相同',
      '\\(a^2\\)',
      '| A | B |\n| --- | --- |\n| 1 | 2 |',
    ]);
    for (const block of blocks) {
      expect(normalized.slice(block.normalized.start, block.normalized.end)).toBe(
        normalizeMathDelimiters(source.slice(block.start, block.end), { detectBareMath: true }),
      );
    }
  });

  it('同一个 HTML 块多个节点合成唯一入口，模型伪造编辑范围会被消毒', () => {
    const source = '<p>A</p>\n<p>B</p>\n\n<div data-edit-start="999">伪造</div>\n\n末段';
    const blocks = imageParseDocumentBlocks(source, source, false);
    const html = renderToStaticMarkup(
      createElement(ReactMarkdown, {
        children: source,
        rehypePlugins: [rehypeRaw, rehypeSanitize, () => imageParseDocumentBlockMarkers(blocks)],
      }),
    );
    const document = new DOMParser().parseFromString(html, 'text/html');
    const markers = document.querySelectorAll('[data-edit-start]');
    expect(markers).toHaveLength(2);
    expect(markers[0].getAttribute('data-edit-start')).toBe('0');
    expect(markers[0].getAttribute('data-edit-end')).toBe('17');
    expect(html).not.toContain('999');
    expect(markers[0].querySelectorAll('p')).toHaveLength(2);
  });

  it('占位图片、脚注及未知 HTML 保留预览，不创建有损编辑器', () => {
    const source = '![image]()\n\n带脚注[^x]\n\n[^x]: 注释\n\n<details>内容</details>\n\n正常';
    const blocks = imageParseDocumentBlocks(source, source, false);
    expect(blocks.map(({ start, end }) => source.slice(start, end))).toEqual(['正常']);
  });
});
