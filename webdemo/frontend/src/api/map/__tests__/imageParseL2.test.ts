import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseImageV2, regenerateImageParseV4 } from '../imageParseV2';
import type { ImageParseSource } from '../imageParseSource';
import { runImageParse } from '@/pages/playground/utils/imageParseRequest';

const mocks = vi.hoisted(() => ({ request: vi.fn(), fetch: vi.fn() }));
vi.mock('../request', () => ({
  mapRequest: mocks.request,
  getToken: () => 'portal-token',
}));

const source: ImageParseSource = {
  requestId: 'a'.repeat(32),
  model: 'minicpm-ocr-aio',
  pageIndex: 3,
  createdAt: 1_800_000_000,
  expiresAt: 1_800_086_400,
  token: 'signed-source',
};
const original = {
  id: 'ocr-3',
  order: 3,
  label: 'text',
  status: 'ok',
  kind: 'text' as const,
  x: 0,
  y: 0,
  w: 1,
  h: 0.1,
  text: '原文',
  markdown: '原文',
  confidence: 0.4,
};
const parseResponse = {
  choices: [{ message: { content: 'recognized text' } }],
  metadata: { page_index: 3 },
  ocr: {
    request_id: source.requestId,
    mode: 'stp',
    image_width: 200,
    image_height: 100,
    blocks: [],
  },
  map_ocr_source: {
    request_id: source.requestId,
    model: source.model,
    page_index: source.pageIndex,
    created_at: source.createdAt,
    expires_at: source.expiresAt,
    token: source.token,
  },
};
const regenerateResponse = {
  choices: [{ message: { content: '优化后的文字' } }],
  metadata: { page_index: 3 },
  ocr: {
    request_id: 'b'.repeat(32),
    source_request_id: source.requestId,
    mode: 'tts_block',
    order: 3,
    prior_score: 0.4,
    block_count: 1,
    blocks: [
      {
        order: 3,
        label: 'text',
        status: 'ok',
        content: '优化后的文字',
        score: 0.9,
        rounds_used: 2,
        stop_reason: 'passed',
        exhausted: false,
      },
    ],
  },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req_l2_image_parse' },
  });
}

function requestInit(call: unknown[]): RequestInit {
  return call[1] as RequestInit;
}

describe('Playground 图片解析 L2 API Key 链路', () => {
  beforeEach(() => {
    mocks.request.mockReset();
    mocks.fetch.mockReset().mockResolvedValue(json(parseResponse));
    vi.stubGlobal('fetch', mocks.fetch);
  });

  it('整页解析直连 L2 chat completions，并携带 API Key、门户身份和客户端关联 ID', async () => {
    await parseImageV2(
      'data:image/png;base64,AA==',
      'scored',
      new AbortController().signal,
      3,
      'minicpm-ocr-aio',
      'plain-secret',
    );

    expect(mocks.fetch).toHaveBeenCalledOnce();
    const [url, init] = mocks.fetch.mock.calls[0]!;
    expect(String(url)).toContain('/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer plain-secret',
      'X-Map-Portal-Token': 'Bearer portal-token',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
    expect(String((init.headers as Record<string, string>)['X-Request-Id'])).toMatch(
      /^map_playground_[a-f\d]{32}$/,
    );
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'minicpm-ocr-aio',
      messages: [
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }],
        },
      ],
      stream: false,
      ocr: { mode: 'standard' },
      page_index: 3,
    });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('OBS 文件引用只提交 file_id，不把本地 base64 放进请求体', async () => {
    await parseImageV2(
      { fileId: 'file_obs_123' },
      'scored',
      new AbortController().signal,
      3,
      'minicpm-ocr-aio',
      'plain-secret',
    );

    const init = requestInit(mocks.fetch.mock.calls[0]!);
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'minicpm-ocr-aio',
      messages: [],
      stream: false,
      ocr: { mode: 'standard' },
      page_index: 3,
      file_id: 'file_obs_123',
    });
  });

  it('旧资产链接只提交 file_url，不把本地 base64 放进请求体', async () => {
    await parseImageV2(
      { fileUrl: 'https://platform-dev.modelbest.co/api/assets/public/asset-token' },
      'scored',
      new AbortController().signal,
      3,
      'minicpm-ocr-aio',
      'plain-secret',
    );

    const init = requestInit(mocks.fetch.mock.calls[0]!);
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'minicpm-ocr-aio',
      messages: [],
      stream: false,
      ocr: { mode: 'standard' },
      page_index: 3,
      file_url: 'https://platform-dev.modelbest.co/api/assets/public/asset-token',
    });
  });

  it('缺少 API Key 时不发起请求，直接返回稳定错误键', async () => {
    await expect(
      parseImageV2(
        'data:image/png;base64,AA==',
        'scored',
        new AbortController().signal,
        0,
        'minicpm-ocr-aio',
        '',
      ),
    ).rejects.toThrow('imageParseAuthFailed');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each(['image/bmp', 'image/webp', 'image/tiff'] as const)(
    '把上游 OCR 支持的 %s 原样提交给 L2',
    async (mime) => {
      const image = `data:${mime};base64,AA==`;
      mocks.fetch.mockResolvedValueOnce(
        json({
          ...parseResponse,
          metadata: { page_index: 0 },
          map_ocr_source: { ...parseResponse.map_ocr_source, page_index: 0 },
        }),
      );

      await runImageParse({
        attachment: {
          id: 'uploaded-image',
          kind: 'image',
          name: `page.${mime.split('/')[1]}`,
          mime,
          size: 1,
          dataUrl: image,
        },
        signal: new AbortController().signal,
        isCurrent: () => true,
        model: 'minicpm-ocr-aio',
        secret: 'plain-secret',
      });

      const init = requestInit(mocks.fetch.mock.calls[0]!);
      expect(JSON.parse(String(init.body)).messages[0].content[0].image_url.url).toBe(image);
    },
  );

  it.each(['playground_trial_exhausted', 'playground_trial_not_eligible'])(
    'L2 返回 %s 时提示免费额度用尽并引导创建 API Key',
    async (code) => {
      mocks.fetch.mockResolvedValueOnce(
        json({ error: { code, message: 'trial unavailable' } }, 402),
      );

      await expect(
        parseImageV2(
          'data:image/png;base64,AA==',
          'scored',
          new AbortController().signal,
          0,
          'minicpm-ocr-aio',
          'trial-secret',
        ),
      ).rejects.toMatchObject({ status: 402, message: 'imageParseTrialExhausted' });
    },
  );

  it.each(['disabled', 'unreachable'])(
    'L3 capabilities 为 %s 时仍通过 L2 解析用户图片',
    async (state) => {
      if (state === 'disabled') mocks.request.mockResolvedValue({ enabled: false });
      else mocks.request.mockRejectedValue(new Error('L3 unavailable'));
      mocks.fetch.mockResolvedValueOnce(
        json({
          ...parseResponse,
          metadata: { page_index: 0 },
          map_ocr_source: { ...parseResponse.map_ocr_source, page_index: 0 },
        }),
      );

      await expect(
        runImageParse({
          attachment: {
            id: 'uploaded-image',
            kind: 'image',
            name: 'page.png',
            mime: 'image/png',
            size: 1,
            dataUrl: 'data:image/png;base64,AA==',
          },
          signal: new AbortController().signal,
          isCurrent: () => true,
          model: 'minicpm-ocr-aio',
          secret: 'plain-secret',
        }),
      ).resolves.toMatchObject({ markdown: 'recognized text' });
      expect(mocks.request).not.toHaveBeenCalled();
      expect(mocks.fetch).toHaveBeenCalledOnce();
    },
  );

  it('块级重算直连 L2，使用 tts_block、source_token、order 和页码', async () => {
    mocks.fetch.mockResolvedValueOnce(json(regenerateResponse));
    await regenerateImageParseV4(
      source,
      original,
      new AbortController().signal,
      'minicpm-ocr-aio',
      'plain-secret',
    );

    expect(mocks.fetch).toHaveBeenCalledOnce();
    const init = requestInit(mocks.fetch.mock.calls[0]!);
    expect(init.headers).toMatchObject({ Authorization: 'Bearer plain-secret' });
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'minicpm-ocr-aio',
      messages: [],
      stream: false,
      ocr: {
        mode: 'tts_block',
        source_token: source.requestId,
        order: 3,
      },
      map_ocr_source: source.token,
      page_index: 3,
    });
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
