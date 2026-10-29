import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../imageParseV2';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../request', () => ({ mapRequest: vi.fn(), getToken: () => 'portal-token' }));

const requestId = 'e74bb0e0b8d04587afb4d53412ef5e69';
const source = {
  requestId,
  model: 'minicpm-ocr-stp' as const,
  pageIndex: 3,
  createdAt: 1_800_000_000,
  expiresAt: 1_800_086_400,
  token: 'signed-source.signature',
};
const original = {
  id: 'ocr-14',
  order: 14,
  label: 'table',
  status: 'ok',
  kind: 'table' as const,
  x: 0.1,
  y: 0.2,
  w: 0.5,
  h: 0.1,
  text: '原文',
  markdown: '原文',
  confidence: 0.04,
};
function blockResponse() {
  return {
    choices: [{ message: { content: '# 优化后' } }],
    metadata: { page_index: 3 },
    ocr: {
      request_id: '8fa9f53857504d36afa4b5878f312f84',
      source_request_id: requestId,
      mode: 'tts_block',
      order: 14,
      prior_score: 0.04,
      block_count: 1,
      blocks: [
        {
          order: 14,
          content: '优化后',
          status: 'ok',
          label: 'table',
          score: 0.7,
          rounds_used: 5,
          stop_reason: 'exhausted',
          exhausted: true,
        },
      ],
      input_image: {},
      future_extension: 'allowed',
    },
  };
}

describe('OCR v4 来源与单块协议', () => {
  beforeEach(() => {
    mocks.request.mockReset();
    vi.stubGlobal('fetch', mocks.request);
  });

  it('整页适配保留服务端签发的来源和原图凭据', () => {
    const result = api.adaptImageParseV2({
      choices: [{ message: { content: '原文' } }],
      ocr: {
        request_id: requestId,
        mode: 'stp',
        image_width: 200,
        image_height: 100,
        blocks: [
          {
            order: 14,
            label: 'table',
            status: 'ok',
            content: '原文',
            bbox: [10, 20, 100, 30],
            score: 0.04,
          },
        ],
        input_image: { sha256: 'a'.repeat(64) },
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
    expect(result.source).toEqual({ ...source, inputImageSha256: 'a'.repeat(64) });
  });

  it('跳过块省略 content 和 score 时仍保留坐标与中性状态', () => {
    const result = api.adaptImageParseV2({
      choices: [{ message: { content: '![image]()' } }],
      ocr: {
        request_id: requestId,
        mode: 'tts',
        image_width: 200,
        image_height: 100,
        blocks: [{ order: 7, label: 'seal', status: 'skipped_no_vlm', bbox: [10, 20, 50, 60] }],
      },
    });
    expect(result.blocks[0]).toMatchObject({ order: 7, text: '', confidence: null });
  });

  it('整页请求直连 L2 并把工作台档位映射为 ocr.mode', async () => {
    mocks.request.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '原文' } }],
          ocr: {
            request_id: requestId,
            mode: 'stp',
            image_width: 200,
            image_height: 100,
            blocks: [],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await api.parseImageV2(
      'data:image/png;base64,AA==',
      'scored',
      new AbortController().signal,
      3,
      'selected-ocr-model',
      'plain-secret',
    );
    expect(mocks.request).toHaveBeenLastCalledWith(
      expect.stringContaining('/v1/chat/completions'),
      expect.objectContaining({
        body: JSON.stringify({
          model: 'selected-ocr-model',
          messages: [
            {
              role: 'user',
              content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }],
            },
          ],
          stream: false,
          ocr: { mode: 'standard' },
          page_index: 3,
        }),
      }),
    );
  });

  it('单块请求直连 L2，只发真实 order、整页引用和页码，不上传原件', async () => {
    mocks.request.mockResolvedValue(
      new Response(JSON.stringify(blockResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const result = await api.regenerateImageParseV4(
      source,
      original,
      new AbortController().signal,
      'selected-ocr-model',
      'plain-secret',
    );
    expect(mocks.request).toHaveBeenLastCalledWith(
      expect.stringContaining('/v1/chat/completions'),
      expect.objectContaining({
        body: JSON.stringify({
          model: 'selected-ocr-model',
          messages: [],
          stream: false,
          ocr: {
            mode: 'tts_block',
            source_token: requestId,
            order: 14,
          },
          map_ocr_source: source.token,
          page_index: 3,
        }),
      }),
    );
    expect(result).toMatchObject({
      markdown: '# 优化后',
      text: '优化后',
      confidence: 0.7,
      roundsUsed: 5,
      priorScore: 0.04,
      sourceRequestId: requestId,
      exhausted: true,
    });
  });

  it('历史来源的旧时间字段不阻止真实重算请求', async () => {
    mocks.request.mockResolvedValue(
      new Response(JSON.stringify(blockResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const historySource = { ...source, createdAt: 1, expiresAt: 86_401 };
    await expect(
      api.regenerateImageParseV4(
        historySource,
        original,
        new AbortController().signal,
        'selected-ocr-model',
        'plain-secret',
      ),
    ).resolves.toMatchObject({ markdown: '# 优化后' });
    expect(mocks.request).toHaveBeenLastCalledWith(
      expect.stringContaining('/v1/chat/completions'),
      expect.objectContaining({
        body: JSON.stringify({
          model: 'selected-ocr-model',
          messages: [],
          stream: false,
          ocr: {
            mode: 'tts_block',
            source_token: requestId,
            order: 14,
          },
          map_ocr_source: source.token,
          page_index: 3,
        }),
      }),
    );
  });

  it('同分结果是正常返回，允许零轮直接复用', async () => {
    const response = blockResponse();
    Object.assign(response.ocr.blocks[0], {
      score: 0.04,
      rounds_used: 0,
      exhausted: false,
    });
    mocks.request.mockResolvedValue(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(
      api.regenerateImageParseV4(
        source,
        original,
        new AbortController().signal,
        'selected-ocr-model',
        'plain-secret',
      ),
    ).resolves.toMatchObject({ confidence: 0.04, roundsUsed: 0 });
  });

  it.each(['source', 'order', 'score', 'page', 'count', 'rounds'])(
    '拒绝身份或评分不匹配的单块响应：%s',
    async (field) => {
      const response = blockResponse();
      if (field === 'source') response.ocr.source_request_id = 'f'.repeat(32);
      if (field === 'order') response.ocr.blocks[0].order = 15;
      if (field === 'score') response.ocr.blocks[0].score = 0.01;
      if (field === 'page') response.metadata.page_index = 2;
      if (field === 'count') response.ocr.block_count = 2;
      if (field === 'rounds') response.ocr.blocks[0].rounds_used = 6;
      mocks.request.mockResolvedValue(
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await expect(
        api.regenerateImageParseV4(
          source,
          original,
          new AbortController().signal,
          'selected-ocr-model',
          'plain-secret',
        ),
      ).rejects.toThrow('imageParseInvalidResult');
    },
  );
});
