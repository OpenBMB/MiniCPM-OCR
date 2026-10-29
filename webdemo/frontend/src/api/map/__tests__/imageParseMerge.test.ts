import { afterEach, describe, expect, it, vi } from 'vitest';

import { crossPageMergeAvailable, mergeImageParseCrossPage } from '../imageParseV2';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../request', () => ({ getToken: () => '', mapRequest: mocks.request }));

const REQUEST_ID = 'a'.repeat(32);

function pageResponse(pageIndex: number) {
  return {
    metadata: { page_index: pageIndex },
    choices: [{ message: { content: '| a |' } }],
    ocr: {
      request_id: REQUEST_ID,
      mode: 'ocr_only' as const,
      image_width: 100,
      image_height: 100,
      blocks: [
        {
          order: 0,
          label: 'table',
          bbox: [0, 0, 50, 50] as [number, number, number, number],
          content: '',
          status: 'ok',
          score: 0.9,
          tts_invalid: true,
          merged_into_previous_page: true,
        },
      ],
    },
  };
}

afterEach(() => mocks.request.mockReset());

describe('mergeImageParseCrossPage', () => {
  it('通过登录态 L3 请求合并，并按页码映射合并标记', async () => {
    mocks.request.mockResolvedValue({ pages: [pageResponse(4)] });
    const merged = await mergeImageParseCrossPage(
      [
        { requestId: REQUEST_ID, pageIndex: 3 },
        { requestId: 'b'.repeat(32), pageIndex: 4 },
      ],
      'minicpm-ocr-aio',
      new AbortController().signal,
    );
    expect(mocks.request).toHaveBeenCalledWith(
      '/image-parse/merge',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          model: 'minicpm-ocr-aio',
          pages: [
            { request_id: REQUEST_ID, page_index: 3 },
            { request_id: 'b'.repeat(32), page_index: 4 },
          ],
        }),
      }),
    );
    expect([...merged.keys()]).toEqual([4]);
    expect(merged.get(4)!.blocks[0]).toMatchObject({
      ttsInvalid: true,
      mergedIntoPreviousPage: true,
      text: '',
    });
  });

  it('返回未请求或重复的页码视为非法结果', async () => {
    mocks.request.mockResolvedValue({ pages: [pageResponse(9)] });
    await expect(
      mergeImageParseCrossPage(
        [{ requestId: REQUEST_ID, pageIndex: 3 }],
        'minicpm-ocr-aio',
        new AbortController().signal,
      ),
    ).rejects.toThrow('imageParseInvalidResult');

    mocks.request.mockResolvedValue({ pages: [pageResponse(3), pageResponse(3)] });
    await expect(
      mergeImageParseCrossPage(
        [{ requestId: REQUEST_ID, pageIndex: 3 }],
        'minicpm-ocr-aio',
        new AbortController().signal,
      ),
    ).rejects.toThrow('imageParseInvalidResult');
  });
});

describe('crossPageMergeAvailable', () => {
  it('仅在 L3 明确返回能力开启时启用', async () => {
    mocks.request.mockResolvedValueOnce({ cross_page_merge: true });
    await expect(crossPageMergeAvailable()).resolves.toBe(true);
    mocks.request.mockResolvedValueOnce({ cross_page_merge: false });
    await expect(crossPageMergeAvailable()).resolves.toBe(false);
    mocks.request.mockRejectedValueOnce(new Error('unavailable'));
    await expect(crossPageMergeAvailable()).resolves.toBe(false);
  });
});
