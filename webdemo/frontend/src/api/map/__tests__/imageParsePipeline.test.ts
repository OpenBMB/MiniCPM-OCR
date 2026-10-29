import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BizError } from '@map/types';

import { loadImageParsePipelineCapabilities, parseImagePipeline } from '../imageParsePipeline';

const mocks = vi.hoisted(() => ({ request: vi.fn(), job: vi.fn() }));
vi.mock('../request', () => ({
  mapRequest: mocks.request,
}));
vi.mock('../imageParseJobs', () => ({ runImageParseJob: mocks.job }));

const sealResponse = {
  choices: [{ message: { content: '印章文字' } }],
  ocr: {
    mode: 'seal',
    image_width: 100,
    image_height: 100,
    blocks: [
      {
        order: 0,
        label: 'seal',
        bbox: [0, 0, 100, 100],
        regions: [[0, 0, 100, 100]],
        content: '印章文字',
        status: 'ok',
      },
    ],
  },
};

const kieResponse = {
  choices: [{ message: { content: '{"店名":"面壁智能","金额":"###"}' } }],
  ocr: {
    mode: 'kie',
    image_width: 100,
    image_height: 100,
    blocks: [
      {
        order: 0,
        label: 'kie',
        bbox: [0, 0, 100, 100],
        regions: [[0, 0, 100, 100]],
        content: '{"店名":"面壁智能","金额":"###"}',
        status: 'ok',
      },
    ],
  },
};

describe('算法图像解析流水线适配', () => {
  beforeEach(() => {
    mocks.request.mockReset();
    mocks.job.mockReset().mockResolvedValue({
      id: 'job',
      status: 'Success',
      pages_done: 1,
      pages_total: 1,
      pages: [sealResponse],
    });
  });

  it('印章任务经 MAP L3 代理提交，不上传 API Key 或算法地址', async () => {
    mocks.request.mockResolvedValue(sealResponse);
    const result = await parseImagePipeline({
      image: 'data:image/png;base64,AA==',
      mode: 'seal',
      model: 'minicpm-ocr-aio',
      signal: new AbortController().signal,
    });
    expect(mocks.request).toHaveBeenCalledWith('/image-parse/pipeline', {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: JSON.stringify({
        model: 'minicpm-ocr-aio',
        task: 'seal',
        image: 'data:image/png;base64,AA==',
      }),
      signal: expect.any(AbortSignal),
    });
    expect(result.markdown).toBe('印章文字');
    expect(result.blocks[0]).toMatchObject({
      id: 'ocr-0',
      kind: 'seal',
      text: '印章文字',
    });
  });

  it('工作台使用 OBS file_id，不把本地 base64 放进请求体', async () => {
    mocks.request.mockResolvedValue(sealResponse);
    await parseImagePipeline({
      fileId: 'file_object_123',
      mode: 'seal',
      model: 'minicpm-ocr-aio',
      signal: new AbortController().signal,
    });
    expect(mocks.job).toHaveBeenCalledExactlyOnceWith({
      model: 'minicpm-ocr-aio',
      task: 'seal',
      fileId: 'file_object_123',
      upright: true,
      recognizeSeal: true,
      signal: expect.any(AbortSignal),
    });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('文件服务不可用时使用平台签名资产链接', async () => {
    mocks.request.mockResolvedValue(sealResponse);
    await parseImagePipeline({
      fileUrl: 'https://platform-dev.modelbest.co/api/assets/public/asset-token',
      mode: 'seal',
      model: 'minicpm-ocr-aio',
      signal: new AbortController().signal,
    });
    const body = JSON.parse(String((mocks.request.mock.calls[0]![1] as RequestInit).body));
    expect(body).toEqual({
      model: 'minicpm-ocr-aio',
      task: 'seal',
      file_url: 'https://platform-dev.modelbest.co/api/assets/public/asset-token',
    });
    expect(body).not.toHaveProperty('image');
    expect(body).not.toHaveProperty('file_id');
  });

  it('信息抽取提交规范化字段并允许 JSON 结果', async () => {
    mocks.request.mockResolvedValue(kieResponse);
    const result = await parseImagePipeline({
      image: 'data:image/png;base64,AA==',
      mode: 'kie',
      model: 'minicpm-ocr-aio',
      fields: [' 店名 ', '金额'],
      signal: new AbortController().signal,
    });
    const body = JSON.parse(String((mocks.request.mock.calls[0]![1] as RequestInit).body));
    expect(body).toEqual({
      model: 'minicpm-ocr-aio',
      task: 'kie',
      image: 'data:image/png;base64,AA==',
      fields: ['店名', '金额'],
    });
    expect(result.markdown).toBe('{"店名":"面壁智能","金额":"###"}');
  });

  it('信息抽取字段非法时不请求后端', async () => {
    await expect(
      parseImagePipeline({
        image: 'data:image/png;base64,AA==',
        mode: 'kie',
        model: 'minicpm-ocr-aio',
        fields: ['店名', '店名'],
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('imageParseKieFieldsDuplicate');
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    '标准档显式提交印章识别开关 %s 时始终固定开启，不改变摆正选项',
    async (recognizeSeal) => {
      mocks.request.mockResolvedValue({
        choices: [{ message: { content: '# 标题' } }],
        ocr: {
          mode: 'ocr_only',
          image_width: 100,
          image_height: 100,
          blocks: [],
        },
      });
      const result = await parseImagePipeline({
        image: 'data:image/png;base64,AA==',
        mode: 'standard',
        model: 'minicpm-ocr-aio',
        pageIndex: 3,
        upright: false,
        recognizeSeal,
        signal: new AbortController().signal,
      });
      const body = JSON.parse(String((mocks.request.mock.calls[0]![1] as RequestInit).body));
      expect(body).toEqual({
        model: 'minicpm-ocr-aio',
        task: 'standard',
        image: 'data:image/png;base64,AA==',
        page_index: 3,
        upright: false,
        recognize_seal: true,
        recognize_chart: true,
      });
      expect(result.markdown).toBe('# 标题');
    },
  );

  it('标准档未指定印章选项时默认开启', async () => {
    mocks.request.mockResolvedValue(sealResponse);
    await parseImagePipeline({
      fileId: 'file_document',
      mode: 'standard',
      model: 'minicpm-ocr-aio',
      signal: new AbortController().signal,
    });
    expect(mocks.job).toHaveBeenCalledWith(expect.objectContaining({ recognizeSeal: true }));
    expect(mocks.job.mock.calls[0]![0]).not.toHaveProperty('pageIndex');
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('单图异步结果保留原页索引校验，不把其他页当作当前结果', async () => {
    mocks.job.mockResolvedValue({
      id: 'job',
      status: 'Success',
      pages_done: 1,
      pages_total: 1,
      pages: [{ ...sealResponse, metadata: { page_index: 4 } }],
    });
    await expect(
      parseImagePipeline({
        fileId: 'file_document',
        mode: 'standard',
        model: 'minicpm-ocr-aio',
        pageIndex: 3,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('imageParseInvalidResult');
    expect(mocks.job).toHaveBeenCalledWith(expect.objectContaining({ pageIndex: 3 }));
  });

  it('单图任务成功但缺少页面时拒绝空结果', async () => {
    mocks.job.mockResolvedValue({
      id: 'job',
      status: 'Success',
      pages_done: 0,
      pages_total: 1,
    });
    await expect(
      parseImagePipeline({
        fileId: 'file_document',
        mode: 'standard',
        model: 'minicpm-ocr-aio',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('imageParseInvalidResult');
  });

  it('印章允许空正文但保留真实区块', async () => {
    mocks.request.mockResolvedValue({
      ...sealResponse,
      choices: [{ message: { content: '' } }],
      ocr: {
        ...sealResponse.ocr,
        blocks: [{ ...sealResponse.ocr.blocks[0], content: '' }],
      },
    });
    const result = await parseImagePipeline({
      image: 'data:image/png;base64,AA==',
      mode: 'seal',
      model: 'minicpm-ocr-aio',
      signal: new AbortController().signal,
    });
    expect(result.markdown).toBe('![image]()');
    expect(result.blocks).toHaveLength(1);
  });

  it('只透出稳定的 MAP 错误键', async () => {
    mocks.request.mockRejectedValue(new BizError(50002, 'upstream detail'));
    await expect(
      parseImagePipeline({
        image: 'data:image/png;base64,AA==',
        mode: 'seal',
        model: 'minicpm-ocr-aio',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('imageParseRequestFailed');
  });
});

describe('图像解析流水线能力探测', () => {
  beforeEach(() => {
    mocks.request.mockReset();
  });

  it('读取能力，并且流水线关闭时不开放印章与抽取', async () => {
    mocks.request.mockResolvedValue({
      pipeline: true,
      seal: true,
      kie: true,
      upright: false,
    });
    const capabilities = await loadImageParsePipelineCapabilities();
    expect(capabilities).toEqual({
      enabled: true,
      modes: [],
      seal: true,
      kie: true,
      upright: false,
    });
    expect(mocks.request).toHaveBeenCalledOnce();

    mocks.request.mockResolvedValue({
      pipeline: false,
      seal: true,
      kie: true,
      upright: false,
    });
    await expect(loadImageParsePipelineCapabilities()).resolves.toEqual({
      enabled: false,
      modes: [],
      seal: false,
      kie: false,
      upright: true,
    });
  });

  it('兼容算法文档的 enabled/modes 能力契约', async () => {
    mocks.request.mockResolvedValue({
      enabled: true,
      modes: ['standard'],
      upright: true,
      seal: true,
      kie: true,
    });
    await expect(loadImageParsePipelineCapabilities()).resolves.toEqual({
      enabled: true,
      modes: ['standard'],
      seal: true,
      kie: true,
      upright: true,
    });
  });

  it('旧版 MAP 只返回 LIS enabled 时不开放流水线入口', async () => {
    mocks.request.mockResolvedValue({ enabled: true, cross_page_merge: true });
    await expect(loadImageParsePipelineCapabilities()).resolves.toEqual({
      enabled: false,
      modes: [],
      seal: false,
      kie: false,
      upright: true,
    });
  });

  it('探测失败时向上抛出，由查询层决定重试', async () => {
    mocks.request.mockRejectedValue(new Error('offline'));
    await expect(loadImageParsePipelineCapabilities()).rejects.toThrow('offline');
  });
});
