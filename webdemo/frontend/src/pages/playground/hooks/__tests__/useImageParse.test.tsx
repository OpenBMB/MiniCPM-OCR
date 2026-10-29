/** 独立 OCR v3 识别生命周期测试。 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Attachment } from '../../types';
import { useImageParse } from '../useImageParse';

const mocks = vi.hoisted(() => ({
  pipeline: vi.fn(),
  upload: vi.fn(),
  crops: vi.fn(),
  pdf: vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/api/map/imageParsePipeline', () => ({
  parseImagePipeline: mocks.pipeline,
}));
vi.mock('@/api/map/fileUploads', () => ({
  uploadPlaygroundFile: mocks.upload,
}));
vi.mock('../../utils/imageParseCrops', () => ({ imageParseCrops: mocks.crops }));
vi.mock('../../utils/pdfImageParse', () => ({ parsePdfPages: mocks.pdf }));

function image(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 'a',
    kind: 'image',
    name: 'page.png',
    mime: 'image/png',
    size: 12,
    dataUrl: 'data:image/png;base64,AAA',
    fileId: 'file_page',
    ...overrides,
  };
}

function model(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-1',
    defaultProjectId: 'project-1',
    imageParseModel: { id: 'minicpm-ocr-aio' },
    getSecret: () => 'plain-secret',
    keysLoading: false,
    hasKeys: true,
    keyId: 'key-1',
    secretReady: true,
    trialRemaining: { language: 0, tts: 0, realtime: 0, 'image-parse': 0 },
    trialAvailable: false,
    ...overrides,
  } as never;
}

const parsed = { markdown: '# OCR result', blocks: [] };
const singleImageTables = {
  markdown:
    '<table><tr><th>名称</th><th>数量</th></tr><tr><td>甲</td><td>1</td></tr></table>\n\n' +
    '<table><tr><td>乙</td><td>2</td></tr></table>',
  blocks: [
    {
      id: 'table-1',
      kind: 'table',
      x: 0,
      y: 0.1,
      w: 1,
      h: 0.2,
      text: '<table><tr><th>名称</th><th>数量</th></tr><tr><td>甲</td><td>1</td></tr></table>',
      markdown: '<table><tr><th>名称</th><th>数量</th></tr><tr><td>甲</td><td>1</td></tr></table>',
      markdownStart: 0,
      markdownEnd: 75,
      confidence: 0.9,
    },
    {
      id: 'table-2',
      kind: 'table',
      x: 0,
      y: 0.31,
      w: 1,
      h: 0.2,
      text: '<table><tr><td>乙</td><td>2</td></tr></table>',
      markdown: '<table><tr><td>乙</td><td>2</td></tr></table>',
      markdownStart: 77,
      markdownEnd: 121,
      confidence: 0.9,
    },
  ],
};

async function attach(current: { current: ReturnType<typeof useImageParse> }, value = image()) {
  await act(async () => current.current.setAttachment(value));
}

describe('useImageParse', () => {
  beforeEach(() => {
    mocks.pipeline.mockReset().mockResolvedValue({ markdown: '流水线结果', blocks: [] });
    mocks.upload.mockReset().mockResolvedValue('file_reuploaded');
    mocks.crops.mockReset().mockResolvedValue([]);
    mocks.pdf.mockReset();
  });

  it('没有文件时不请求 OCR', async () => {
    const { result } = renderHook(() => useImageParse(model()));
    await act(() => result.current.parse());
    expect(result.current.error).toBe('imageParseNeedImage');
    expect(mocks.pipeline).not.toHaveBeenCalled();
  });

  it('默认文档识别提交文件服务 file_id 并调用算法流水线', async () => {
    const { result } = renderHook(() => useImageParse(model()));
    await attach(result);
    await waitFor(() => expect(mocks.pipeline).toHaveBeenCalledOnce());
    expect(mocks.pipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: 'file_page',
        mode: 'standard',
        model: 'minicpm-ocr-aio',
        pageIndex: 0,
        upright: true,
      }),
    );
    expect(result.current.markdown).toBe('流水线结果');
  });

  it('单图相邻表格识别后自动合并，并可通过结果栏撤销', async () => {
    mocks.pipeline.mockResolvedValueOnce(singleImageTables);
    const { result } = renderHook(() => useImageParse(model()));
    await attach(result);

    await waitFor(() => expect(result.current.imageTableMerge?.status).toBe('merged'));
    expect(result.current.markdown.match(/<table/g)).toHaveLength(1);
    expect(result.current.layout).toHaveLength(1);

    await act(async () => result.current.imageTableMerge?.unmerge());

    expect(result.current.imageTableMerge?.status).toBe('idle');
    expect(result.current.markdown).toBe(singleImageTables.markdown);
    expect(result.current.layout).toEqual(singleImageTables.blocks);
  });

  it('替换附件时释放旧 PDF Blob URL', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const { result } = renderHook(() => useImageParse(model()));
    await act(async () => result.current.setAttachment(image({ dataUrl: 'blob:first-pdf' })));
    await act(async () => result.current.setAttachment(image({ id: 'second' })));

    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:first-pdf');
    revoke.mockRestore();
  });

  it('无文档解析模型权限时不查询服务配置，也不发起代理请求', async () => {
    const { result } = renderHook(() => useImageParse(model({ imageParseModel: undefined })));
    await attach(result);
    await act(() => result.current.parse());
    expect(result.current.error).toBe('imageParseNoModel');
    expect(mocks.pipeline).not.toHaveBeenCalled();
  });

  it('文档档位切换仍使用算法标准任务，不切换 LIS 模型', async () => {
    const { result } = renderHook(() => useImageParse(model()));
    await attach(result);
    await waitFor(() => expect(mocks.pipeline).toHaveBeenCalledOnce());
    await act(async () => result.current.setMode('high-precision'));
    await waitFor(() => expect(mocks.pipeline).toHaveBeenCalledTimes(2));
    expect(mocks.pipeline.mock.calls[1][0]).toMatchObject({ mode: 'standard' });
    act(() => result.current.setMode('scored'));
    await waitFor(() => expect(mocks.pipeline).toHaveBeenCalledTimes(3));
    expect(mocks.pipeline.mock.calls[2][0]).toMatchObject({ mode: 'standard' });
  });

  it('算法服务不可用时显示错误，不回退 LIS 或内联图片', async () => {
    mocks.pipeline.mockRejectedValue(new Error('imageParseServiceUnavailable'));
    const { result } = renderHook(() => useImageParse(model()));
    await attach(result);
    await waitFor(() => expect(result.current.error).toBe('imageParseServiceUnavailable'));
    expect(result.current.loading).toBe(false);
    expect(result.current.markdown).toBe('');
    expect(mocks.pipeline).toHaveBeenCalledOnce();
  });

  it('项目变化只清理当前结果，不复用旧解析', async () => {
    const { result, rerender } = renderHook(
      ({ project }) => useImageParse(model({ defaultProjectId: project })),
      { initialProps: { project: 'project-1' } },
    );
    await attach(result);
    await waitFor(() => expect(result.current.markdown).toBe('流水线结果'));
    rerender({ project: 'project-2' });
    await waitFor(() => expect(result.current.attachment).toBeUndefined());
    expect(result.current.markdown).toBe('');
  });

  it('上传后立即产生可恢复快照，完成后更新正文', async () => {
    let finish!: (value: typeof parsed) => void;
    mocks.pipeline.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useImageParse(model()));
    expect(result.current.snapshot).toBeNull();
    await attach(result);
    await waitFor(() => expect(mocks.pipeline).toHaveBeenCalledOnce());
    expect(result.current.snapshot).toMatchObject({
      attachment: image(),
      markdown: '',
      layout: [],
    });
    await act(async () => finish(parsed));
    expect(result.current.snapshot).toMatchObject({
      attachment: image(),
      markdown: parsed.markdown,
    });
  });

  it('跨档位恢复本地结果不调用 OCR，并使旧请求失效', async () => {
    let finish!: (value: typeof parsed) => void;
    mocks.pipeline.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useImageParse(model()));
    await act(async () => result.current.setMode('high-precision'));
    await attach(result);
    await waitFor(() => expect(mocks.pipeline).toHaveBeenCalledOnce());
    act(() =>
      result.current.restore({
        attachment: image({ id: 'cached' }),
        mode: 'scored',
        markdown: '# Cached',
        layout: [],
      }),
    );
    await act(async () => finish(parsed));
    expect(result.current.markdown).toBe('# Cached');
    expect(result.current.mode).toBe('standard');
    expect(result.current.loading).toBe(false);
    expect(mocks.pipeline).toHaveBeenCalledOnce();
  });

  it('印章模式走 L3 流水线，不读取或调用 L2 API Key', async () => {
    const { result } = renderHook(() => useImageParse(model()));
    await attach(result);
    await waitFor(() => expect(mocks.pipeline).toHaveBeenCalledOnce());
    await act(async () => result.current.setMode('seal'));
    await waitFor(() => expect(mocks.pipeline).toHaveBeenCalledTimes(2));
    expect(mocks.pipeline).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fileId: 'file_page',
        mode: 'seal',
        model: 'minicpm-ocr-aio',
        fields: [],
        upright: false,
      }),
    );
    expect(result.current.markdown).toBe('流水线结果');
  });

  it('算法标准档走 L3 流水线，首次及重新识别均自动摆正', async () => {
    const { result } = renderHook(() => useImageParse(model()));
    await attach(result);
    await waitFor(() => expect(mocks.pipeline).toHaveBeenCalledOnce());
    await act(async () => result.current.setMode('standard-pipeline'));
    await waitFor(() => expect(mocks.pipeline).toHaveBeenCalledTimes(2));
    expect(mocks.pipeline).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fileId: 'file_page',
        mode: 'standard',
        model: 'minicpm-ocr-aio',
        pageIndex: 0,
        upright: true,
      }),
    );
    await act(async () => result.current.parse());
    expect(mocks.pipeline).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'standard', upright: true }),
    );
  });

  it('算法档位会把旧历史的本地图片补传为 OBS 文件引用', async () => {
    const { result } = renderHook(() => useImageParse(model()));
    await attach(result, image({ fileId: undefined }));
    await waitFor(() => expect(mocks.pipeline).toHaveBeenCalledOnce());
    await act(async () => result.current.setMode('seal'));
    await waitFor(() => expect(mocks.pipeline).toHaveBeenCalledTimes(2));
    expect(mocks.upload).toHaveBeenCalledWith(
      expect.any(File),
      'project-1',
      expect.any(AbortSignal),
    );
    expect(mocks.pipeline).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'file_reuploaded', mode: 'seal' }),
    );
    expect(result.current.attachment?.fileId).toBe('file_reuploaded');
  });

  it('默认文档识别也会把旧历史的本地图片补传为 OBS 文件引用', async () => {
    const { result } = renderHook(() => useImageParse(model()));
    await attach(result, image({ fileId: undefined }));
    await waitFor(() => expect(mocks.pipeline).toHaveBeenCalledOnce());
    expect(mocks.upload).toHaveBeenCalledWith(
      expect.any(File),
      'project-1',
      expect.any(AbortSignal),
    );
    expect(mocks.pipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: 'file_reuploaded',
        mode: 'standard',
        model: 'minicpm-ocr-aio',
      }),
    );
    expect(result.current.attachment?.fileId).toBe('file_reuploaded');
  });

  it('没有 file_id 的历史图片不会使用旧资产链接或内联图片兜底', async () => {
    const { result } = renderHook(() => useImageParse(model()));
    mocks.upload.mockRejectedValue(new Error('upload failed'));
    await attach(result, image({ fileId: undefined }));
    await waitFor(() => expect(result.current.error).toBe('imageParseFileReferenceUploadFailed'));
    expect(mocks.pipeline).not.toHaveBeenCalled();
  });

  it('算法档位补传失败时不回退内联图片', async () => {
    mocks.upload.mockRejectedValue(new Error('upload failed'));
    const { result } = renderHook(() => useImageParse(model()));
    await attach(result, image({ fileId: undefined }));
    await act(async () => result.current.setMode('seal'));
    await waitFor(() => expect(result.current.error).toBe('imageParseFileReferenceUploadFailed'));
    expect(mocks.pipeline).not.toHaveBeenCalled();
  });

  it('信息抽取字段未填时不自动发起请求，填写后再调用流水线', async () => {
    const { result } = renderHook(() => useImageParse(model()));
    await attach(result);
    await waitFor(() => expect(mocks.pipeline).toHaveBeenCalledOnce());
    mocks.pipeline.mockReset();
    await act(async () => result.current.setMode('kie'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.pipeline).not.toHaveBeenCalled();
    expect(result.current.error).toBeUndefined();

    act(() => result.current.setFields(['店名']));
    await act(async () => result.current.parse());
    expect(mocks.pipeline).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'kie', fields: ['店名'] }),
    );
  });

  it('共享票据逐页恢复原图与结果，不自动识别且不产生个人历史', async () => {
    const { result } = renderHook(() => useImageParse(model()));
    for (const [name, markdown] of [
      ['invoice.png', '第一页'],
      ['taxi.png', '第二页'],
    ]) {
      await act(async () => {
        expect(
          result.current.restore({
            attachment: image({ id: 'example:invoices', name }),
            mode: 'scored',
            markdown,
            layout: [],
          }),
        ).toBe(true);
      });
      expect(result.current.attachment?.name).toBe(name);
      expect(result.current.markdown).toBe(markdown);
      expect(result.current.pdf).toBeUndefined();
      expect(result.current.snapshot).toBeNull();
    }
    expect(mocks.pipeline).not.toHaveBeenCalled();
  });

  it('待采集共享案例显式恢复原图，不把空正文认定为成功识别或个人历史', async () => {
    const { result } = renderHook(() => useImageParse(model()));
    const preview = {
      attachment: image({ id: 'example:invoices' }),
      mode: 'scored' as const,
      markdown: '',
      layout: [],
    };
    expect(result.current.restore(preview)).toBe(false);
    await act(async () => {
      expect(result.current.restore(preview, { previewOnly: true })).toBe(true);
    });
    expect(result.current.attachment?.id).toBe('example:invoices');
    expect(result.current.markdown).toBe('');
    expect(result.current.snapshot).toBeNull();
    expect(mocks.pipeline).not.toHaveBeenCalled();
    expect(
      result.current.restore(
        { ...preview, attachment: image({ id: 'private' }) },
        { previewOnly: true },
      ),
    ).toBe(false);
  });
});
