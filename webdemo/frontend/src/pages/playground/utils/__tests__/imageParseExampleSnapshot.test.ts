import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadImageParseExampleSnapshot } from '../imageParseExampleSnapshot';
import { IMAGE_PARSE_SHARED_EXAMPLES } from '../imageParseExamples';

const original = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', original);

function imageResponse() {
  return {
    ok: true,
    blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
  };
}

afterEach(() => {
  original.mockReset();
});

describe('共享案例原件预览', () => {
  it('案例暂不预识别，只恢复原件和空结果', async () => {
    original.mockResolvedValue(imageResponse());
    const snapshot = await loadImageParseExampleSnapshot(
      'physics',
      new AbortController().signal,
    );

    expect(original).toHaveBeenCalledOnce();
    expect(snapshot).toMatchObject({
      attachment: { id: 'example:physics', kind: 'image' },
      markdown: '',
      layout: [],
    });
    expect(snapshot.pdf).toBeUndefined();
  });

  it.each(
    IMAGE_PARSE_SHARED_EXAMPLES.filter((example) => example.format === 'PNG').map(
      (example) => example.type,
    ),
  )('%s 图片案例不生成正文或版面块', async (type) => {
    original.mockResolvedValue(imageResponse());
    const snapshot = await loadImageParseExampleSnapshot(type, new AbortController().signal);
    expect(snapshot.markdown).toBe('');
    expect(snapshot.layout).toEqual([]);
  });

  it.each(['newspaper', 'leave-calendar'] as const)('%s PDF 案例只恢复原件和页数', async (type) => {
    const snapshot = await loadImageParseExampleSnapshot(type, new AbortController().signal);
    expect(original).not.toHaveBeenCalled();
    expect(snapshot).toMatchObject({
      attachment: { id: `example:${type}`, kind: 'file', mime: 'application/pdf' },
      markdown: '',
      layout: [],
      pdf: { page: 1, pages: 1, results: {} },
    });
  });

  it('取消读取后拒绝迟到的图片原件结果', async () => {
    const controller = new AbortController();
    original.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          controller.abort();
          reject(new DOMException('aborted', 'AbortError'));
        }),
    );
    await expect(loadImageParseExampleSnapshot('physics', controller.signal)).rejects.toMatchObject(
      {
        name: 'AbortError',
      },
    );
  });
});
