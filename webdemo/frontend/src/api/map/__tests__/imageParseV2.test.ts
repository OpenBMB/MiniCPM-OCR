import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adaptImageParseV2, parseImageV2 } from '../imageParseV2';
import { imageParseBlockRanges } from '@/pages/playground/utils/imageParseBlocks';
import { imageParseQuality } from '@/pages/playground/utils/imageParseQuality';
import { imageParseCrops } from '@/pages/playground/utils/imageParseCrops';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../request', () => ({ mapRequest: vi.fn(), getToken: () => 'portal-token' }));

const sample = {
  choices: [{ message: { content: '# 标题\n\n正文\n\n![image]()' } }],
  ocr: {
    request_id: 'req-1',
    mode: 'stp' as const,
    image_width: 200,
    image_height: 100,
    blocks: [
      {
        order: 1,
        label: 'paragraph',
        bbox: [20, 20, 120, 40] as [number, number, number, number],
        content: '正文',
        status: 'ok',
        score: 0.5,
      },
      {
        order: 0,
        label: 'title',
        bbox: [0, 0, 180, 20] as [number, number, number, number],
        content: '标题',
        status: 'ok',
        score: 0.9,
      },
      {
        order: 2,
        label: 'image',
        bbox: [20, 40, 120, 80] as [number, number, number, number],
        content: '',
        status: 'skipped_no_vlm',
      },
      {
        order: 3,
        label: 'seal',
        bbox: [130, 40, 180, 80] as [number, number, number, number],
        content: '',
        status: 'missing_crop',
      },
    ],
  },
};

describe('页图解析 v3 契约', () => {
  beforeEach(() => {
    mocks.request.mockReset().mockImplementation(
      async () =>
        new Response(JSON.stringify(sample), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', mocks.request);
  });

  it('按从 0 开始的阅读顺序定位，并区分低分、跳过与失败', () => {
    const result = adaptImageParseV2(sample);
    expect(result.blocks.map((block) => block.order)).toEqual([0, 1, 2, 3]);
    expect(result.blocks[1]).toMatchObject({ x: 0.1, y: 0.2, w: 0.5, h: 0.2, confidence: 0.5 });
    expect(imageParseQuality(result.blocks).suggested.map((item) => item.order)).toEqual([2]);
    expect(imageParseQuality(result.blocks).skipped).toHaveLength(1);
    expect(imageParseQuality(result.blocks).failed).toHaveLength(1);
    // The image and the empty seal each have one placeholder, and the title and body can both be located.
    expect([...imageParseBlockRanges(result.markdown, result.blocks)]).toHaveLength(4);
  });

  it('把浏览器打不开的插图路径改成原图占位符', () => {
    const result = adaptImageParseV2({
      ...sample,
      choices: [
        {
          message: {
            content:
              '# 标题\n\n正文\n\n![image](imgs/document/002_img_in_image_box_20_40_120_80.png)\n\n![image](https://example.com/kept.png)',
          },
        },
      ],
    });
    expect(result.markdown).toContain('![image]()');
    expect(result.markdown).not.toContain('imgs/document');
    expect(result.markdown).toContain('https://example.com/kept.png');
  });

  it('来源索引与本次识别不一致时只丢弃来源，不影响正文', () => {
    const requestId = 'e74bb0e0b8d04587afb4d53412ef5e69';
    const result = adaptImageParseV2({
      ...sample,
      ocr: { ...sample.ocr, request_id: requestId },
      map_ocr_source: {
        request_id: 'f'.repeat(32),
        model: 'minicpm-ocr-webdemo',
        page_index: 0,
        created_at: 1_792_464_752,
        expires_at: 1_792_551_152,
        token: 'upstream-source-token',
      },
    });
    expect(result.source).toBeUndefined();
    expect(result.blocks).toHaveLength(4);
    expect(result.markdown).toContain('正文');
  });

  it('来源模型与当前选择不一致时禁用重算，但保留识别结果', async () => {
    const requestId = 'e74bb0e0b8d04587afb4d53412ef5e69';
    mocks.request.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...sample,
          ocr: { ...sample.ocr, request_id: requestId },
          map_ocr_source: {
            request_id: requestId,
            model: 'minicpm-ocr-webdemo',
            page_index: 0,
            created_at: 1_792_464_752,
            expires_at: 1_792_551_152,
            token: 'upstream-source-token',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await parseImageV2(
      'data:image/png;base64,AA==',
      'scored',
      new AbortController().signal,
      0,
      'minicpm-ocr-aio',
      'plain-secret',
    );
    expect(result.source).toBeUndefined();
    expect(result.markdown).toContain('正文');
  });

  it('保留 v3 图片类块的语义类型，供叠框和裁图使用', () => {
    const result = adaptImageParseV2({
      ...sample,
      ocr: {
        ...sample.ocr,
        blocks: ['image', 'chart', 'seal', 'header_image'].map((label, order) => ({
          order,
          label,
          bbox: [0, order, 10, order + 1] as [number, number, number, number],
          content: '',
          status: 'skipped_no_vlm',
        })),
      },
    });
    expect(result.blocks.map((block) => block.kind)).toEqual(['image', 'chart', 'seal', 'image']);
  });

  it('适配旋转、多区域、页脚与跨页表格合并元数据', () => {
    const rotated = {
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
            regions: [[100, 900, 500, 950]],
            content: '第 1 页',
            status: 'ok',
            score: 0.99,
          },
          {
            order: 2,
            label: 'footer_image',
            bbox: [700, 900, 800, 950] as [number, number, number, number],
            regions: [[700, 900, 800, 950]],
            content: '',
            status: 'skipped_no_vlm',
          },
        ],
      },
    };

    const result = adaptImageParseV2(rotated);
    expect(result.rotation).toEqual({
      enabled: true,
      applied: true,
      totalAngle: 89.58,
      predictedAngle: 90,
      predictedScore: 0.97,
      confirmed: true,
      orientationAngle: 90,
      deskewAngle: -0.42,
      skippedReason: null,
    });
    expect(result.blocks[0]).toMatchObject({
      ttsInvalid: true,
      regions: [
        { x: 0.1, y: 0.1, w: 0.2, h: 0.3 },
        { x: 0.6, y: 0.1, w: 0.2, h: 0.3 },
      ],
    });
    expect(result.blocks.map((block) => block.kind)).toEqual(['table', 'footer', 'image']);
  });

  it('拒绝非法 regions，避免合并表格只显示错误局部框', () => {
    const invalid = {
      ...sample,
      ocr: {
        ...sample.ocr,
        blocks: [
          {
            ...sample.ocr.blocks[0],
            regions: [[20, 20, 120, 40] as const, [250, 20, 300, 40] as const],
          },
        ],
      },
    };

    expect(() => adaptImageParseV2(invalid)).toThrow('imageParseInvalidResult');
  });

  it('不为未打分的 OCR-only 块补造分数，也不按错误数量裁图', async () => {
    const result = adaptImageParseV2({
      ...sample,
      ocr: {
        ...sample.ocr,
        mode: 'ocr_only',
        blocks: sample.ocr.blocks.map(({ score: _score, ...block }) => block),
      },
    });
    expect(result.blocks.every((block) => block.confidence === null)).toBe(true);
    expect(
      await imageParseCrops(
        result.markdown,
        result.blocks,
        'data:image/png;base64,AA==',
        new AbortController().signal,
      ),
    ).toEqual([]);
  });

  it('上游 score=-1 视为未知置信度，不拒绝整份共享 PDF', () => {
    const result = adaptImageParseV2({
      ...sample,
      ocr: {
        ...sample.ocr,
        blocks: sample.ocr.blocks.map((block) =>
          block.order === 0 ? { ...block, score: -1 } : block,
        ),
      },
    });

    expect(result.blocks[0].confidence).toBeNull();
    expect(imageParseQuality(result.blocks).missing).toBe(3);
  });

  it('三档分别映射真实模型和 ocr.mode，只发送单张 data URI', async () => {
    for (const [mode, upstreamMode] of [
      ['standard', 'ocr_only'],
      ['scored', 'standard'],
      ['high-precision', 'standard'],
    ] as const) {
      await parseImageV2(
        'data:image/png;base64,AA==',
        mode,
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
            ocr: { mode: upstreamMode },
            page_index: 3,
          }),
        }),
      );
    }
  });

  it('模型必须来自模型列表选择结果，不使用测试期默认模型', async () => {
    mocks.request.mockClear();
    await expect(
      parseImageV2(
        'data:image/png;base64,AA==',
        'scored',
        new AbortController().signal,
        0,
        undefined as unknown as string,
        'plain-secret',
      ),
    ).rejects.toThrow('imageParseNoModel');
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('拒绝与请求页码不一致的上游响应，防止并发结果错页', async () => {
    mocks.request.mockResolvedValueOnce(
      new Response(JSON.stringify({ ...sample, metadata: { page_index: 2 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(
      parseImageV2(
        'data:image/png;base64,AA==',
        'scored',
        new AbortController().signal,
        1,
        'selected-ocr-model',
        'plain-secret',
      ),
    ).rejects.toThrow('imageParseInvalidResult');
  });

  it('非法像素 bbox 和重复阅读序号直接拒绝', () => {
    const bad = {
      ...sample,
      ocr: {
        ...sample.ocr,
        blocks: sample.ocr.blocks.map((block) => ({ ...block })),
      },
    };
    bad.ocr.blocks[0].bbox = [0, 0, 250, 10];
    expect(() => adaptImageParseV2(bad)).toThrow('imageParseInvalidResult');
    bad.ocr.blocks[0].bbox = [20, 20, 120, 40];
    bad.ocr.blocks[0].order = 0;
    expect(() => adaptImageParseV2(bad)).toThrow('imageParseInvalidResult');
  });
});
