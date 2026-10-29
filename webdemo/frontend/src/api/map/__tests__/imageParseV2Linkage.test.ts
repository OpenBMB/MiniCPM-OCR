import { describe, expect, it } from 'vitest';

import { imageParseBlockRanges } from '@/pages/playground/utils/imageParseBlocks';
import { sanitizeImageParseSnapshot } from '@/pages/playground/utils/imageParseHistorySnapshot';

import { adaptImageParseV2 } from '../imageParseV2';

function response(markdown: string, texts: readonly string[]) {
  return {
    choices: [{ message: { content: markdown } }],
    ocr: {
      request_id: 'a'.repeat(32),
      mode: 'tts' as const,
      image_width: 1000,
      image_height: 1000,
      blocks: texts.map((content, order) => ({
        order,
        content,
        label: content.startsWith('## ') ? 'paragraph_title' : 'text',
        status: 'ok',
        score: 0.99,
        bbox: [0, order * 10, 100, order * 10 + 10] as [number, number, number, number],
      })),
    },
  };
}

describe('OCR 重复编号的上下文定位', () => {
  it('正文保留漏检编号时，其余编号按前后完整块定位，不改写模型原文', () => {
    const sections = ['第一题', '第二题', '第三题', '第四题', '第五题'];
    const markdown = sections.map((title) => `## ${title}\n\n01A\n\n${title}正文`).join('\n\n');
    const texts = sections.flatMap((title, index) =>
      index === 2 ? [`## ${title}`, `${title}正文`] : [`## ${title}`, '01A', `${title}正文`],
    );
    const raw = response(markdown, texts);
    const result = adaptImageParseV2(raw);
    const ranges = imageParseBlockRanges(result.markdown, result.blocks);

    expect(result.markdown).toBe(markdown);
    expect(raw.ocr.blocks.map((block) => block.content)).toEqual(texts);
    for (const title of sections.filter((_, index) => index !== 2)) {
      const order = texts.indexOf(`## ${title}`) + 1;
      const start = markdown.indexOf('01A', markdown.indexOf(`## ${title}`));
      expect(ranges.get(`ocr-${order}`)).toEqual({ start, end: start + 3 });
    }
  });

  it('同一上下文仍有多处同名编号时不猜测，其它唯一上下文仍可定位', () => {
    const markdown = '## 第一题\n\n01A\n\n第一题正文\n\n## 第二题\n\n01A\n\n01A\n\n第二题正文';
    const result = adaptImageParseV2(
      response(markdown, ['## 第一题', '01A', '第一题正文', '## 第二题', '01A', '第二题正文']),
    );
    const ranges = imageParseBlockRanges(result.markdown, result.blocks);

    expect(result.markdown).toBe(markdown);
    expect(ranges.get('ocr-1')).toEqual({
      start: markdown.indexOf('01A'),
      end: markdown.indexOf('01A') + 3,
    });
    expect(ranges.has('ocr-4')).toBe(false);
  });

  it('没有上下文锚点的重复编号继续禁止映射，不补写或删除正文', () => {
    const markdown = '01A\n\n01A';
    const result = adaptImageParseV2(response(markdown, ['01A']));

    expect(result.markdown).toBe(markdown);
    expect(imageParseBlockRanges(result.markdown, result.blocks).size).toBe(0);
  });

  it('恢复旧历史时重建缺失的编号映射，不修改缓存正文或原始快照', () => {
    const markdown = '## 第一题\n\n01A\n\n第一题正文\n\n## 第二题\n\n01A\n\n第二题正文';
    const parsed = adaptImageParseV2(
      response(markdown, ['## 第一题', '第一题正文', '## 第二题', '01A', '第二题正文']),
    );
    const layout = parsed.blocks.map((block) =>
      block.text === '01A'
        ? { ...block, markdown: '', markdownStart: undefined, markdownEnd: undefined }
        : block,
    );
    const cached = {
      attachment: {
        id: 'old-image',
        kind: 'image',
        name: 'old-image.png',
        mime: 'image/png',
        size: 1,
        dataUrl: 'data:image/png;base64,AA==',
      },
      mode: 'high-precision',
      markdown,
      layout,
    };
    const restored = sanitizeImageParseSnapshot(cached);
    const start = markdown.lastIndexOf('01A');

    expect(restored?.markdown).toBe(markdown);
    expect(imageParseBlockRanges(markdown, restored!.layout).get('ocr-3')).toEqual({
      start,
      end: start + 3,
    });
    expect(cached.layout[3].markdown).toBe('');
  });

  it('恢复已编辑的历史正文时不补写旧识别文字', () => {
    const markdown = '## 第一题\n\n01A\n\n原始正文\n\n## 第二题\n\n01A\n\n第二题正文';
    const parsed = adaptImageParseV2(
      response(markdown, ['## 第一题', '原始正文', '## 第二题', '01A', '第二题正文']),
    );
    const edited = markdown.replace('原始正文', '人工修改后的正文');
    const restored = sanitizeImageParseSnapshot({
      attachment: {
        id: 'edited-image',
        kind: 'image',
        name: 'edited-image.png',
        mime: 'image/png',
        size: 1,
        dataUrl: 'data:image/png;base64,AA==',
      },
      mode: 'high-precision',
      markdown: edited,
      layout: parsed.blocks.map((block) => ({
        ...block,
        markdown: block.text === '01A' ? '' : block.markdown,
        markdownStart: undefined,
        markdownEnd: undefined,
      })),
    });

    expect(restored?.markdown).toBe(edited);
    expect(restored?.markdown).not.toContain('原始正文');
  });

  it('重复列表项不被整个列表的边界错误判为唯一', () => {
    const markdown = '## 第一题\n\n- 01A\n- 01A\n\n题目正文';
    const result = adaptImageParseV2(response(markdown, ['## 第一题', '01A', '题目正文']));

    expect(result.markdown).toBe(markdown);
    expect(imageParseBlockRanges(result.markdown, result.blocks).has('ocr-1')).toBe(false);
  });
});

describe('OCR 图片与正文顺序不一致的定位', () => {
  it.each(['image', 'chart', 'seal'])('图片占位符位于正文前时仍保留 %s 块定位', (label) => {
    const text = '（2）所求的功为';
    const markdown = `![image]()\n\n${text}\n\n图 3`;
    const raw = response(markdown, [text, '']);
    raw.ocr.blocks[1].label = label;
    raw.ocr.blocks[1].status = 'skipped_no_vlm';
    const result = adaptImageParseV2(raw);
    const ranges = imageParseBlockRanges(result.markdown, result.blocks);

    expect(result.markdown).toBe(markdown);
    expect(ranges.get('ocr-0')).toEqual({
      start: markdown.indexOf(text),
      end: markdown.indexOf(text) + text.length,
    });
    expect(ranges.get('ocr-1')).toEqual({ start: 0, end: '![image]()'.length });
  });

  it('图片块先于正文块时不消耗正文位置或重复补入正文', () => {
    const text = '（2）所求的功为';
    const markdown = `${text}\n\n![image]()\n\n图 3`;
    const raw = response(markdown, ['', text]);
    raw.ocr.blocks[0].label = 'image';
    raw.ocr.blocks[0].status = 'skipped_no_vlm';
    const result = adaptImageParseV2(raw);
    const ranges = imageParseBlockRanges(result.markdown, result.blocks);

    expect(result.markdown).toBe(markdown);
    expect(ranges.get('ocr-0')).toEqual({
      start: markdown.indexOf('![image]()'),
      end: markdown.indexOf('![image]()') + '![image]()'.length,
    });
    expect(ranges.get('ocr-1')).toEqual({ start: 0, end: text.length });
  });

  it.each(['\n\n', ' '])('多张前置图片分别匹配占位符，不共用同一位置：%j', (separator) => {
    const placeholder = '![image]()';
    const text = '正文';
    const markdown = `${placeholder}${separator}${placeholder}\n\n${text}`;
    const raw = response(markdown, [text, '', '']);
    raw.ocr.blocks.slice(1).forEach((block) => {
      block.label = 'image';
      block.status = 'skipped_no_vlm';
    });
    const result = adaptImageParseV2(raw);
    const ranges = imageParseBlockRanges(result.markdown, result.blocks);

    expect(result.markdown).toBe(markdown);
    expect(ranges.size).toBe(3);
    expect(ranges.get('ocr-1')).toEqual({ start: 0, end: placeholder.length });
    expect(ranges.get('ocr-2')).toEqual({
      start: placeholder.length + separator.length,
      end: placeholder.length * 2 + separator.length,
    });
  });

  describe('OCR 新版元数据的历史恢复', () => {
    it('保留多区域、跨页合并标记与旋转信息，不丢弃新版接口证据', () => {
      const raw = {
        choices: [{ message: { content: '<table><tr><td>A</td></tr></table>\n\n第 1 页' } }],
        ocr: {
          request_id: 'a'.repeat(32),
          mode: 'tts' as const,
          image_width: 1000,
          image_height: 1000,
          rotation: {
            enabled: true,
            applied: true,
            total_angle: 89.58,
            predicted_angle: 90,
            predicted_score: 0.97,
            confirmed: true,
            orientation_angle: 90,
            deskew_angle: -0.42,
            skipped_reason: null,
          },
          blocks: [
            {
              order: 0,
              label: 'table',
              bbox: [100, 100, 500, 400] as [number, number, number, number],
              regions: [
                [100, 100, 300, 400],
                [600, 100, 800, 400],
              ],
              content: '<table><tr><td>A</td></tr></table>',
              status: 'ok',
              score: 0.42,
              tts_invalid: true,
            },
            {
              order: 1,
              label: 'footer',
              bbox: [100, 900, 500, 950] as [number, number, number, number],
              content: '第 1 页',
              status: 'ok',
              score: 0.99,
            },
          ],
        },
      };
      const parsed = adaptImageParseV2(raw);
      const restored = sanitizeImageParseSnapshot({
        attachment: {
          id: 'metadata-image',
          kind: 'image',
          name: 'metadata.png',
          mime: 'image/png',
          size: 1,
          dataUrl: 'data:image/png;base64,AA==',
        },
        mode: 'high-precision',
        markdown: parsed.markdown,
        layout: parsed.blocks,
        rotation: parsed.rotation,
      });

      expect(restored?.rotation).toEqual(parsed.rotation);
      expect(restored?.layout[0]).toMatchObject({
        ttsInvalid: true,
        regions: [
          { x: 0.1, y: 0.1, w: 0.2, h: 0.3 },
          { x: 0.6, y: 0.1, w: 0.2, h: 0.3 },
        ],
      });
      expect(restored?.layout[1].kind).toBe('footer');
    });
  });

  it('图片块与占位符数量不一致时仍不猜测配对', () => {
    const markdown = '![image]()\n\n正文';
    const raw = response(markdown, ['正文', '', '']);
    raw.ocr.blocks.slice(1).forEach((block) => {
      block.label = 'image';
      block.status = 'skipped_no_vlm';
    });
    const result = adaptImageParseV2(raw);
    const ranges = imageParseBlockRanges(result.markdown, result.blocks);

    expect(result.markdown).toBe(markdown);
    expect([...ranges.keys()]).toEqual(['ocr-0']);
  });

  it.each(['image', 'chart', 'seal'])(
    '恢复旧历史时重建空文字 %s 块的图片映射，不修改缓存正文',
    (label) => {
      const markdown = '![image]()\n\n正文';
      const raw = response(markdown, ['正文', '']);
      raw.ocr.blocks[1].label = label;
      raw.ocr.blocks[1].status = 'skipped_no_vlm';
      const parsed = adaptImageParseV2(raw);
      const cached = {
        attachment: {
          id: 'old-image',
          kind: 'image',
          name: 'old-image.png',
          mime: 'image/png',
          size: 1,
          dataUrl: 'data:image/png;base64,AA==',
        },
        mode: 'high-precision',
        markdown,
        layout: parsed.blocks.map((block) =>
          block.kind === label
            ? { ...block, markdown: '', markdownStart: undefined, markdownEnd: undefined }
            : block,
        ),
      };
      const restored = sanitizeImageParseSnapshot(cached);

      expect(restored?.markdown).toBe(markdown);
      expect(imageParseBlockRanges(markdown, restored!.layout).get('ocr-1')).toEqual({
        start: 0,
        end: '![image]()'.length,
      });
      expect(cached.layout[1].markdown).toBe('');
    },
  );
});
