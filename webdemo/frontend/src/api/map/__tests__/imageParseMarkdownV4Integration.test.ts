import { beforeEach, describe, expect, it, vi } from 'vitest';

import { imageParseBlockRanges } from '@/pages/playground/utils/imageParseBlocks';
import { imageParseDraftRanges } from '@/pages/playground/utils/imageParseDraftRanges';
import { regenerateMappedImageParseBlock } from '@/pages/playground/utils/imageParseRegeneration';
import { imageParseBlockGenerator } from '@/pages/playground/utils/imageParseRegenerationRequest';

import { adaptImageParseV2 } from '../imageParseV2';
import { validateImageParseSdkResult, type ImageParseSdkResult } from '../imageParseSdk';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../request', () => ({ mapRequest: vi.fn(), getToken: () => 'portal-token' }));

const source = {
  requestId: 'a'.repeat(32),
  model: 'minicpm-ocr-stp' as const,
  pageIndex: 0,
  createdAt: Math.floor(Date.now() / 1000),
  expiresAt: Math.floor(Date.now() / 1000) + 86_400,
  token: 'signed-ocr-test-scope',
};

function adapt(markdown: string, contents: string[]) {
  return adaptImageParseV2({
    choices: [{ message: { content: markdown } }],
    ocr: {
      request_id: source.requestId,
      mode: 'stp',
      image_width: 1000,
      image_height: 1000,
      blocks: contents.map((content, order) => ({
        order,
        content,
        label: 'text',
        status: 'ok',
        score: 0.4,
        bbox: [0, order * 10, 100, order * 10 + 10],
      })),
    },
    map_ocr_source: {
      request_id: source.requestId,
      model: source.model,
      page_index: source.pageIndex,
      created_at: source.createdAt,
      expires_at: source.expiresAt,
      token: source.token,
    },
  });
}

function response(order: number, markdown: string) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: markdown } }],
      metadata: { page_index: source.pageIndex },
      ocr: {
        request_id: 'b'.repeat(32),
        source_request_id: source.requestId,
        mode: 'tts_block',
        order,
        prior_score: 0.4,
        block_count: 1,
        blocks: [
          {
            order,
            content: '优化后的正文',
            status: 'ok',
            label: 'text',
            score: 0.9,
            rounds_used: 1,
            stop_reason: 'threshold',
            exhausted: false,
          },
        ],
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function createDraft(result: ImageParseSdkResult) {
  let value = result.markdown;
  let ranges = imageParseBlockRanges(value, result.blocks);
  const update = (next: string, range?: { start: number; end: number }) => {
    ranges = imageParseDraftRanges(value, next, ranges, range);
    value = next;
  };
  return { get: () => ({ value, ranges }), update, apply: vi.fn(update) };
}

function regenerate(
  result: ImageParseSdkResult,
  order: number,
  draft: ReturnType<typeof createDraft>,
) {
  const original = result.blocks[order];
  const signal = new AbortController().signal;
  return regenerateMappedImageParseBlock({
    id: original.id!,
    original,
    currentBest: original,
    signal,
    getDraft: draft.get,
    onApply: draft.apply,
    generate: imageParseBlockGenerator(
      {
        source: result.source,
        model: 'minicpm-ocr-aio',
        secret: 'plain-secret',
        documentDataUrl: '',
        mime: 'image/png',
        pageIndex: source.pageIndex,
      },
      original,
      original.id!,
      signal,
    ),
  });
}

describe('whole-page Markdown adaptation through v4 block application', () => {
  beforeEach(() => {
    mocks.request.mockReset();
    vi.stubGlobal('fetch', mocks.request);
  });

  it.each([
    ['# 原文', '# 优化后的正文'],
    ['## 原文 ##', '## 优化后的正文'],
    ['原文\n====', '# 优化后的正文'],
    ['**原文**', '**优化后的正文**'],
    ['# 原文\n\n第二段', '# 优化后的正文\n\n优化后的第二段'],
  ])('should replace complete Markdown syntax for %s', async (fragment, replacement) => {
    const contents = fragment.includes('第二段') ? '原文\n\n第二段' : '原文';
    const result = adapt(`# 合同\n\n${fragment}\n\n结尾`, ['合同', contents, '结尾']);
    const draft = createDraft(result);
    expect(validateImageParseSdkResult(result)).toBe(result);
    mocks.request.mockImplementation(async () => response(1, replacement));
    await regenerate(result, 1, draft);
    expect(draft.get().value).toBe(`# 合同\n\n${replacement}\n\n结尾`);
    expect(result.blocks[1].markdown).toBe(fragment);
    expect(JSON.parse(String(mocks.request.mock.calls[0]?.[1]?.body))).toEqual({
      model: 'minicpm-ocr-aio',
      messages: [],
      stream: false,
      ocr: {
        mode: 'tts_block',
        source_token: source.requestId,
        order: 1,
      },
      map_ocr_source: source.token,
      page_index: 0,
    });
    expect(mocks.request).toHaveBeenCalledOnce();
  });

  it.each([
    ['- 原文\n- 邻接条目', '- 原文', '- 优化后的正文', '- 邻接条目'],
    ['1. 原文\n2. 邻接条目', '1. 原文', '1. 优化后的正文', '2. 邻接条目'],
    ['- [ ] 原文\n- [x] 邻接条目', '- [ ] 原文', '- [ ] 优化后的正文', '- [x] 邻接条目'],
    ['- 原文\n  续行\n- 邻接条目', '- 原文\n  续行', '- 优化后的正文', '- 邻接条目'],
  ])(
    'should consume one complete listItem without replacing its neighbor: %s',
    async (list, item, replacement, neighbor) => {
      const result = adapt(`# 合同\n\n${list}\n\n结尾`, [
        '合同',
        item.includes('续行') ? '原文续行' : '原文',
        '邻接条目',
        '结尾',
      ]);
      const draft = createDraft(result);
      mocks.request.mockImplementation(async () => response(1, replacement));
      await regenerate(result, 1, draft);
      expect(draft.get().value).toBe(`# 合同\n\n${replacement}\n${neighbor}\n\n结尾`);
      expect(result.blocks[1].markdown).toBe(item);
      expect(result.blocks[2].markdown).toBe(neighbor);
      const neighborRange = draft.get().ranges.get('ocr-2')!;
      expect(draft.get().value.slice(neighborRange.start, neighborRange.end)).toBe(neighbor);
    },
  );

  it('should map a whole-list OCR block to the complete list', async () => {
    const list = '- 原文\n- 邻接条目';
    const result = adapt(`前言\n\n${list}\n\n结尾`, ['前言', '原文\n邻接条目', '结尾']);
    const draft = createDraft(result);
    mocks.request.mockImplementation(async () => response(1, '- 优化后的正文\n- 优化后的条目'));
    await regenerate(result, 1, draft);
    expect(result.blocks[1].markdown).toBe(list);
    expect(draft.get().value).toBe('前言\n\n- 优化后的正文\n- 优化后的条目\n\n结尾');
  });

  it('should replace consecutive complete list items while retaining the remaining item', async () => {
    const result = adapt('- 原文\n- 次条目\n- 邻接条目', ['原文\n次条目', '邻接条目']);
    const draft = createDraft(result);
    mocks.request.mockImplementation(async () => response(0, '- 优化后的正文\n- 新次条目'));
    await regenerate(result, 0, draft);
    expect(draft.get().value).toBe('- 优化后的正文\n- 新次条目\n- 邻接条目');
    const neighbor = draft.get().ranges.get('ocr-1')!;
    expect(draft.get().value.slice(neighbor.start, neighbor.end)).toBe('- 邻接条目');
  });

  it('should keep distinct ranges for repeated items and apply sequential v4 results', async () => {
    const result = adapt('- 重复\n- 重复\n\n结尾', ['重复', '重复', '结尾']);
    const draft = createDraft(result);
    mocks.request.mockImplementationOnce(async () => response(0, '- 优化后的第一条目'));
    await regenerate(result, 0, draft);
    mocks.request.mockImplementationOnce(async () => response(1, '- 第二条目'));
    await regenerate(result, 1, draft);
    expect(draft.get().value).toBe('- 优化后的第一条目\n- 第二条目\n\n结尾');
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['原文邻接文字', ['原文', '邻接文字']],
    ['- 原文邻接文字\n- 其他条目', ['原文', '邻接文字', '其他条目']],
    ['- 重复\n- 重复', ['重复']],
    ['- 原文\n- 邻接条目', ['原文\n邻接条目', '邻接条目']],
    ['A\n\nB\n\nC', ['A\n\nB', 'B\n\nC']],
  ])(
    'should disable unsafe or ambiguous replacement without adding duplicate text: %s',
    async (markdown, contents) => {
      const result = adapt(markdown, contents);
      const draft = createDraft(result);
      expect(result.markdown).toBe(markdown);
      expect(draft.get().ranges.has('ocr-0')).toBe(false);
      await expect(regenerate(result, 0, draft)).rejects.toThrow('imageParseRegenerateUnmapped');
      expect(mocks.request).not.toHaveBeenCalled();
      expect(draft.apply).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['# 原文', '## 原文'],
    ['- 原文\n- 邻接条目', '* 原文\n- 邻接条目'],
    ['- [ ] 原文\n- 邻接条目', '- [x] 原文\n- 邻接条目'],
    ['**原文**', '*原文*'],
    ['原文\n----', '原文\n===='],
  ])(
    'should refuse v4 before requesting when a format marker was edited: %s',
    async (markdown, edited) => {
      const contents = markdown.includes('邻接') ? ['原文', '邻接条目'] : ['原文'];
      const result = adapt(markdown, contents);
      const draft = createDraft(result);
      draft.update(edited);
      mocks.request.mockImplementation(async () => response(0, '# 优化后的正文'));
      await expect(regenerate(result, 0, draft)).rejects.toThrow('imageParseRegenerateEdited');
      expect(draft.get().value).toBe(edited);
      expect(mocks.request).not.toHaveBeenCalled();
      expect(draft.apply).not.toHaveBeenCalled();
    },
  );

  it('should preserve a format marker edited while a v4 request is pending', async () => {
    const result = adapt('# 合同\n\n# 原文', ['合同', '原文']);
    const draft = createDraft(result);
    let finish!: (value: ReturnType<typeof response>) => void;
    mocks.request.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = regenerate(result, 1, draft);
    draft.update('# 合同\n\n## 原文');
    finish(response(1, '# 优化后的正文'));
    await expect(pending).rejects.toThrow('imageParseRegenerateEdited');
    expect(draft.get().value).toBe('# 合同\n\n## 原文');
    expect(mocks.request).toHaveBeenCalledOnce();
    expect(draft.apply).not.toHaveBeenCalled();
  });

  it('should preserve adjacent marker edits and shift the target range while v4 is pending', async () => {
    const result = adapt('# 合同\n\n- 原文\n- 邻接条目', ['合同', '原文', '邻接条目']);
    const draft = createDraft(result);
    let finish!: (value: ReturnType<typeof response>) => void;
    mocks.request.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = regenerate(result, 1, draft);
    draft.update('## 合同\n\n- 原文\n- 邻接条目');
    draft.update('## 合同\n\n- 原文\n* 邻接条目');
    finish(response(1, '- 优化后的正文'));
    await pending;
    expect(draft.get().value).toBe('## 合同\n\n- 优化后的正文\n* 邻接条目');
    expect(mocks.request).toHaveBeenCalledOnce();
  });
});
