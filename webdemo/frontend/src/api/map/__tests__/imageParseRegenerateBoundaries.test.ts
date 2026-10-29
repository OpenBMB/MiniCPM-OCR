import { beforeEach, describe, expect, it, vi } from 'vitest';

import { imageParseBlockRanges } from '@/pages/playground/utils/imageParseBlocks';
import { regenerateMappedImageParseBlock } from '@/pages/playground/utils/imageParseRegeneration';

import { adaptImageParseV2, regenerateImageParseV4 } from '../imageParseV2';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../request', () => ({ mapRequest: vi.fn(), getToken: () => 'portal-token' }));

const source = {
  requestId: 'a'.repeat(32),
  model: 'minicpm-ocr-tts' as const,
  pageIndex: 0,
  createdAt: Math.floor(Date.now() / 1000),
  expiresAt: Math.floor(Date.now() / 1000) + 86_400,
  token: 'synthetic-test-source',
};
const original = {
  id: 'ocr-2',
  order: 2,
  label: 'text',
  status: 'ok',
  kind: 'text' as const,
  x: 0,
  y: 0,
  w: 1,
  h: 0.1,
  text: '原文',
  markdown: '原文',
  confidence: 0.43,
};

function fixture(order = original.order) {
  const block: Record<string, unknown> = {
    order,
    label: 'text',
    status: 'ok',
    content: '优化后的文字',
    score: 0.99,
    rounds_used: 2,
    stop_reason: 'passed',
    exhausted: false,
  };
  const ocr: Record<string, unknown> = {
    request_id: 'b'.repeat(32),
    source_request_id: source.requestId,
    mode: 'tts_block',
    order,
    prior_score: original.confidence,
    block_count: 1,
    blocks: [block],
  };
  return {
    block,
    ocr,
    response: {
      choices: [{ message: { content: '优化后的文字' } }],
      metadata: { page_index: source.pageIndex },
      ocr: ocr,
    },
  };
}

interface Boundary {
  name: string;
  mutate: (value: ReturnType<typeof fixture>) => void;
}

// 记录现有拒绝行为用于排查，不代表这些边界都是合理的产品要求。
const rejected: Boundary[] = [
  {
    name: '聚合 Markdown 为空但块正文非空',
    mutate: ({ response }) => {
      response.choices[0].message.content = '';
    },
  },
  {
    name: '聚合 Markdown 只有空白',
    mutate: ({ response }) => {
      response.choices[0].message.content = ' \n ';
    },
  },
  {
    name: '缺少 prior_score',
    mutate: ({ ocr }) => {
      delete ocr.prior_score;
    },
  },
  {
    name: 'prior_score 为字符串',
    mutate: ({ ocr }) => {
      ocr.prior_score = '0.43';
    },
  },
  {
    name: 'prior_score 超出范围',
    mutate: ({ ocr }) => {
      ocr.prior_score = 1.1;
    },
  },
  {
    name: '缺少 rounds_used',
    mutate: ({ block }) => {
      delete block.rounds_used;
    },
  },
  {
    name: 'rounds_used 超过五轮',
    mutate: ({ block }) => {
      block.rounds_used = 6;
    },
  },
  {
    name: 'rounds_used 不是整数',
    mutate: ({ block }) => {
      block.rounds_used = 1.5;
    },
  },
  {
    name: '缺少 stop_reason',
    mutate: ({ block }) => {
      delete block.stop_reason;
    },
  },
  {
    name: '缺少 exhausted',
    mutate: ({ block }) => {
      delete block.exhausted;
    },
  },
  {
    name: '优化字段放在 ocr 而非块上',
    mutate: ({ ocr, block }) => {
      for (const key of ['rounds_used', 'stop_reason', 'exhausted']) {
        ocr[key] = block[key];
        delete block[key];
      }
    },
  },
  {
    name: '新分数低于页面原分数',
    mutate: ({ block }) => {
      block.score = 0.42;
    },
  },
  {
    name: '新分数低于服务端 prior_score',
    mutate: ({ ocr, block }) => {
      ocr.prior_score = 0.9;
      block.score = 0.8;
    },
  },
  {
    name: '来源请求不匹配',
    mutate: ({ ocr }) => {
      ocr.source_request_id = 'c'.repeat(32);
    },
  },
  {
    name: '块编号不匹配',
    mutate: ({ block }) => {
      block.order = 5;
    },
  },
  {
    name: '页码不匹配',
    mutate: ({ response }) => {
      response.metadata.page_index = 1;
    },
  },
];

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('单块重生成红字的诊断边界', () => {
  beforeEach(() => {
    mocks.request.mockReset();
    vi.stubGlobal('fetch', mocks.request);
  });

  it.each(rejected)('$name 会触发同一个通用错误', async ({ mutate }) => {
    const value = fixture();
    mutate(value);
    mocks.request.mockImplementation(async () => response(value.response));
    await expect(
      regenerateImageParseV4(
        source,
        original,
        new AbortController().signal,
        'minicpm-ocr-aio',
        'plain-secret',
      ),
    ).rejects.toThrow('imageParseInvalidResult');
    expect(mocks.request).toHaveBeenCalledOnce();
  });

  it.each([2, 5])('跳号 order=%i 且单块不返回 bbox 时正常通过', async (order) => {
    const value = fixture(order);
    mocks.request.mockImplementation(async () => response(value.response));
    await expect(
      regenerateImageParseV4(
        source,
        { ...original, order },
        new AbortController().signal,
        'minicpm-ocr-aio',
        'plain-secret',
      ),
    ).resolves.toMatchObject({ confidence: 0.99 });
  });

  it('原分数与新分数都为零时正常通过，不把零分视作缺失', async () => {
    const value = fixture();
    value.ocr.prior_score = 0;
    value.block.score = 0;
    value.block.rounds_used = 0;
    mocks.request.mockImplementation(async () => response(value.response));
    await expect(
      regenerateImageParseV4(
        source,
        { ...original, confidence: 0 },
        new AbortController().signal,
        'minicpm-ocr-aio',
        'plain-secret',
      ),
    ).resolves.toMatchObject({ confidence: 0, roundsUsed: 0 });
  });

  it('同分且轮次耗尽是正常无提升结果', async () => {
    const value = fixture();
    value.block.score = original.confidence;
    value.block.rounds_used = 5;
    value.block.stop_reason = 'exhausted';
    value.block.exhausted = true;
    mocks.request.mockImplementation(async () => response(value.response));
    await expect(
      regenerateImageParseV4(
        source,
        original,
        new AbortController().signal,
        'minicpm-ocr-aio',
        'plain-secret',
      ),
    ).resolves.toMatchObject({ confidence: 0.43, roundsUsed: 5, exhausted: true });
  });

  it.each([
    ['header', 2, 0.43782349911420193],
    ['aside_text', 5, 0.009708475013027696],
    ['footer', 7, 0.43],
  ] as const)(
    '整页补回 %s 后，单块返回空 Markdown 会报错但保留草稿',
    async (label, order, score) => {
      const result = adaptImageParseV2({
        choices: [{ message: { content: '正文' } }],
        ocr: {
          request_id: source.requestId,
          mode: 'tts',
          image_width: 100,
          image_height: 100,
          blocks: [
            {
              order,
              label,
              status: 'ok',
              content: '导航文字',
              bbox: [0, 0, 100, 10],
              score,
            },
            {
              order: order + 1,
              label: 'text',
              status: 'ok',
              content: '正文',
              bbox: [0, 20, 100, 30],
              score: 0.99,
            },
          ],
        },
      });
      const target = result.blocks[0];
      expect(target.markdown).toBe('导航文字');
      const value = fixture(target.order);
      value.response.choices[0].message.content = '';
      value.block.label = label;
      value.ocr.prior_score = score;
      Object.assign(value.block, {
        score,
        rounds_used: 5,
        stop_reason: 'exhausted',
        exhausted: true,
      });
      mocks.request.mockImplementation(async () => response(value.response));
      const onApply = vi.fn();
      const signal = new AbortController().signal;
      await expect(
        regenerateMappedImageParseBlock({
          id: target.id!,
          original: target,
          currentBest: target,
          signal,
          getDraft: () => ({
            value: result.markdown,
            ranges: imageParseBlockRanges(result.markdown, result.blocks),
          }),
          onApply,
          generate: () =>
            regenerateImageParseV4(source, target, signal, 'minicpm-ocr-aio', 'plain-secret'),
        }),
      ).rejects.toThrow('imageParseInvalidResult');
      expect(onApply).not.toHaveBeenCalled();
      expect(mocks.request).toHaveBeenCalledOnce();
      // 只修改聚合 Markdown 即可通过，隔离空正文与分数、轮次、身份校验的影响。
      value.response.choices[0].message.content = '优化后的文字';
      await expect(
        regenerateImageParseV4(source, target, signal, 'minicpm-ocr-aio', 'plain-secret'),
      ).resolves.toMatchObject({
        confidence: score,
        roundsUsed: 5,
        exhausted: true,
      });
    },
  );
});
