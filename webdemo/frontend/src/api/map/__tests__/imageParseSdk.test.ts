import { afterEach, describe, expect, it, vi } from 'vitest';

import { validateImageParseSdkResult } from '../imageParseSdk';
import { runImageParse } from '@/pages/playground/utils/imageParseRequest';
import { IMAGE_PARSE_SAMPLE_BLOCKS } from '@/pages/playground/utils/__tests__/imageParseSampleFixtures';

const mocks = vi.hoisted(() => ({ enabled: vi.fn(), v2: vi.fn() }));
vi.mock('../imageParseV2', () => ({
  imageParseV2Enabled: mocks.enabled,
  parseImageV2: mocks.v2,
}));
afterEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockResolvedValue(false);
});

const block = { ...IMAGE_PARSE_SAMPLE_BLOCKS[2], id: 'b', markdown: 'SDK text' };
const response = { markdown: 'SDK text', blocks: [block] };
const args = () => ({
  model: 'minicpm-ocr-aio',
  attachment: {
    id: 'a',
    kind: 'image' as const,
    name: 'a.png',
    mime: 'image/png',
    size: 12,
    dataUrl: 'data:image/png;base64,AA==',
  },
  signal: new AbortController().signal,
  isCurrent: () => true,
  secret: 'plain-secret',
});

describe('OCR SDK 接入边界', () => {
  it('三档均直连 L2，不查询 L3 配置或调用传统模型', async () => {
    mocks.enabled.mockResolvedValue(true);
    mocks.v2.mockResolvedValue(response);
    for (const mode of ['standard', 'scored', 'high-precision'] as const) {
      await expect(runImageParse({ ...args(), mode })).resolves.toEqual(response);
      expect(mocks.v2).toHaveBeenLastCalledWith(
        { image: 'data:image/png;base64,AA==' },
        mode,
        expect.any(AbortSignal),
        0,
        'minicpm-ocr-aio',
        'plain-secret',
      );
    }
    expect(mocks.enabled).not.toHaveBeenCalled();
  });

  it('无文档解析模型时不查询服务配置，也不发起代理请求', async () => {
    await expect(runImageParse({ ...args(), model: '', mode: 'scored' })).rejects.toThrow(
      'imageParseNoModel',
    );
    expect(mocks.enabled).not.toHaveBeenCalled();
    expect(mocks.v2).not.toHaveBeenCalled();
  });

  it('有 OBS 文件引用时只提交 fileId，不回退本地 base64', async () => {
    mocks.v2.mockResolvedValue(response);
    const base = args();
    await expect(
      runImageParse({
        ...base,
        mode: 'scored',
        attachment: { ...base.attachment, fileId: 'file_obs_123' },
      }),
    ).resolves.toEqual(response);
    expect(mocks.v2).toHaveBeenLastCalledWith(
      { fileId: 'file_obs_123' },
      'scored',
      expect.any(AbortSignal),
      0,
      'minicpm-ocr-aio',
      'plain-secret',
    );
  });

  it('L3 未配置 OCR 代理时仍调用 L2，不回退传统模型', async () => {
    mocks.enabled.mockResolvedValue(false);
    mocks.v2.mockResolvedValue(response);
    await expect(runImageParse({ ...args(), mode: 'high-precision' })).resolves.toEqual(response);
    expect(mocks.enabled).not.toHaveBeenCalled();
    expect(mocks.v2).toHaveBeenCalledOnce();
  });

  it('L2 不可用时保留真实错误，不回退传统模型', async () => {
    mocks.v2.mockRejectedValue(new Error('imageParseServiceUnavailable'));
    await expect(runImageParse({ ...args(), mode: 'high-precision' })).rejects.toThrow(
      'imageParseServiceUnavailable',
    );
    expect(mocks.v2).toHaveBeenCalledOnce();
    expect(mocks.enabled).not.toHaveBeenCalled();
  });

  it('缺失分数与空块列表可用，越界坐标和非法分数拒绝展示', () => {
    expect(
      validateImageParseSdkResult({ ...response, blocks: [{ ...block, confidence: null }] })
        .blocks[0].confidence,
    ).toBeNull();
    expect(validateImageParseSdkResult({ ...response, blocks: [] }).blocks).toEqual([]);
    for (const invalid of [
      { x: -1 },
      { w: 2 },
      { h: 0 },
      { confidence: 1.01 },
      { confidence: NaN },
    ]) {
      expect(() =>
        validateImageParseSdkResult({ ...response, blocks: [{ ...block, ...invalid }] }),
      ).toThrow('imageParseInvalidResult');
    }
    expect(() => validateImageParseSdkResult({ markdown: '', blocks: [] })).toThrow(
      'imageParseEmptyResponse',
    );
    expect(() => validateImageParseSdkResult({ ...response, blocks: [block, block] })).toThrow(
      'imageParseInvalidResult',
    );
    expect(() =>
      validateImageParseSdkResult({
        ...response,
        blocks: [{ ...block, markdownStart: 0, markdownEnd: 100 }],
      }),
    ).toThrow('imageParseInvalidResult');
  });
});
