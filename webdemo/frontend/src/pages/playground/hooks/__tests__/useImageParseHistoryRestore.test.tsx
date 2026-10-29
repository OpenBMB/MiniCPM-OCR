import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useImageParse } from '../useImageParse';
import type { ImageParseSnapshot } from '../../utils/imageParseHistory';

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  enabled: vi.fn(),
  pdf: vi.fn(),
  crops: vi.fn(),
  pdfCrops: vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/api/map/imageParseV2', () => ({
  imageParseV2Enabled: mocks.enabled,
  parseImageV2: mocks.parse,
}));
vi.mock('@/api/map/imageParsePipeline', () => ({
  parseImagePipeline: vi.fn(),
}));
vi.mock('../../utils/pdfImageParse', () => ({ parsePdfPages: mocks.pdf }));
vi.mock('../../utils/imageParseCrops', () => ({ imageParseCrops: mocks.crops }));
vi.mock('../../utils/pdfImageParseCrops', () => ({ rebuildPdfPageCrops: mocks.pdfCrops }));

const cached: ImageParseSnapshot = {
  attachment: {
    id: 'pdf',
    kind: 'file',
    name: 'scan.pdf',
    mime: 'application/pdf',
    size: 12,
    dataUrl: 'data:application/pdf;base64,AAA',
  },
  mode: 'scored',
  markdown: '# Page two',
  layout: [],
  pdf: {
    page: 2,
    pages: 3,
    results: {
      1: { result: { markdown: '# Page one', blocks: [] } },
      2: { result: { markdown: '# Page two', blocks: [] } },
      3: { error: 'imageParseRequestFailed' },
    },
  },
};
const completePdf: ImageParseSnapshot = {
  ...cached,
  pdf: {
    ...cached.pdf!,
    results: {
      ...cached.pdf!.results,
      3: { result: { markdown: '# Page three', blocks: [] } },
    },
  },
};
const imageParseModel = { id: 'minicpm-ocr-aio' };
const model = {
  userId: 'u',
  defaultProjectId: 'p',
  imageParseModel,
  getSecret: () => 'plain-secret',
} as never;
const cachedImage: ImageParseSnapshot = {
  attachment: {
    id: 'image',
    kind: 'image',
    name: 'scan.png',
    mime: 'image/png',
    size: 12,
    dataUrl: 'data:image/png;base64,AAA',
  },
  mode: 'high-precision',
  markdown: '# Cached',
  layout: [],
};
const source = {
  requestId: 'a'.repeat(32),
  model: 'minicpm-ocr-tts' as const,
  pageIndex: 0,
  createdAt: 1,
  expiresAt: 86401,
  token: 'signed-ocr-scope-token',
};

describe('useImageParse cached restore integration', () => {
  beforeEach(() => {
    mocks.parse.mockReset();
    mocks.enabled.mockReset();
    mocks.pdf.mockReset();
    mocks.crops.mockReset().mockResolvedValue([]);
    mocks.pdfCrops.mockReset().mockResolvedValue(['data:image/png;base64,CACHED']);
  });

  it('旧 PDF 缓存恢复后保留页码与已完成页，只续跑失败页', async () => {
    const { result } = renderHook(() => useImageParse(model));
    act(() => result.current.restore(cached));
    await waitFor(() => expect(mocks.pdf).toHaveBeenCalledOnce());
    expect(result.current.mode).toBe('standard');
    expect(result.current.markdown).toBe('# Page two');
    expect(result.current.pdf?.page).toBe(2);
    expect(result.current.snapshot?.pdf).toEqual(cached.pdf);
    const [, , , , , , , onlyPage, , skipPages] = mocks.pdf.mock.calls[0] as [
      string,
      string,
      string,
      string,
      AbortSignal,
      (pages: number) => void,
      (page: number, result: unknown) => void,
      number | undefined,
      (() => number) | undefined,
      ReadonlySet<number> | undefined,
    ];
    expect(onlyPage).toBeUndefined();
    expect([...skipPages!]).toEqual([1, 2]);
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.enabled).not.toHaveBeenCalled();
    act(() => result.current.pdf?.setPage(1));
    expect(result.current.markdown).toBe('# Page one');
    expect(result.current.snapshot?.pdf?.page).toBe(1);
  });

  it('should reuse sanitized shared PDF pages across example switches without revalidating all pages', async () => {
    const shared = {
      ...cached,
      attachment: { ...cached.attachment, id: 'example:annual-report' },
    };
    const { result } = renderHook(() => useImageParse(model));
    act(() => result.current.restore(shared));
    const pages = result.current.pdf?.results;
    act(() => result.current.restore(cachedImage));
    act(() => result.current.restore(shared));

    expect(result.current.pdf?.results).toBe(pages);
    expect(result.current.markdown).toBe('# Page two');
    expect(mocks.pdf).not.toHaveBeenCalled();
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it('停止旧 PDF 任务，忽略其延迟页结果和结束回调', async () => {
    let finish!: () => void;
    mocks.pdf.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useImageParse(model));
    await act(async () =>
      result.current.setAttachment({
        ...cached.attachment,
        id: 'old',
        dataUrl: 'data:application/pdf;base64,OLD',
      }),
    );
    await waitFor(() => expect(mocks.pdf).toHaveBeenCalledOnce());
    const [, , , , signal, , onPage] = mocks.pdf.mock.calls[0];
    act(() => result.current.restore(completePdf));
    expect((signal as AbortSignal).aborted).toBe(true);
    await act(async () => {
      onPage(2, { result: { markdown: '# Stale', blocks: [] } });
      finish();
    });
    expect(result.current.markdown).toBe('# Page two');
    expect(result.current.pdf?.page).toBe(2);
    expect(result.current.loading).toBe(false);
    expect(mocks.pdf).toHaveBeenCalledOnce();
  });

  it('恢复云端 PDF fileId 记录时接受重新签出的短时原件链接', async () => {
    const runtimeURL = 'https://files.example/signed.pdf';
    const cloudPDF = {
      ...cached,
      attachment: { ...cached.attachment, dataUrl: runtimeURL, fileId: 'file_pdf' },
    };
    const { result } = renderHook(() => useImageParse(model));

    act(() => result.current.restore({ ...cloudPDF, pdf: completePdf.pdf }));

    expect(result.current.markdown).toBe('# Page two');
    expect(result.current.snapshot?.attachment.dataUrl).toBe(runtimeURL);
    expect(result.current.snapshot?.attachment.fileId).toBe('file_pdf');
    expect(mocks.pdf).not.toHaveBeenCalled();
  });

  it('从缓存本地原件重建裁图且不进行 OCR 请求', async () => {
    mocks.crops.mockResolvedValue(['data:image/png;base64,CACHED']);
    const { result } = renderHook(() => useImageParse(model));
    act(() => result.current.restore(cachedImage));
    await waitFor(() => expect(result.current.crops).toEqual(['data:image/png;base64,CACHED']));
    expect(mocks.crops).toHaveBeenCalledWith(
      '# Cached',
      [],
      cachedImage.attachment.dataUrl,
      expect.any(AbortSignal),
      undefined,
      { allPictures: true },
    );
    expect(mocks.enabled).not.toHaveBeenCalled();
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it('恢复后切换项目不复用缓存原件，也不启动自动 OCR', async () => {
    const { result, rerender } = renderHook(
      ({ project }) =>
        useImageParse({
          userId: 'u',
          defaultProjectId: project,
          imageParseModel,
          getSecret: () => 'plain-secret',
        } as never),
      { initialProps: { project: 'p1' } },
    );
    act(() => result.current.restore(cachedImage));
    rerender({ project: 'p2' });
    expect(result.current.snapshot).toBeNull();
    await waitFor(() => expect(result.current.attachment).toBeUndefined());
    expect(result.current.markdown).toBe('');
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it('should restore an expired image source while defaulting future parse mode to algorithm standard', async () => {
    const { result } = renderHook(() => useImageParse(model));
    act(() => result.current.restore({ ...cachedImage, mode: 'scored', source }));
    await act(async () => {});
    expect(result.current.mode).toBe('standard');
    expect(result.current.markdown).toBe(cachedImage.markdown);
    expect(result.current.source).toEqual(source);
    expect(result.current.snapshot?.source).toEqual(source);
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.enabled).not.toHaveBeenCalled();
  });

  it('should preserve each PDF source independently when restoring and navigating pages', async () => {
    const first = { ...source, requestId: 'a'.repeat(32) };
    const second = { ...source, requestId: 'b'.repeat(32), pageIndex: 1 };
    const withSources = {
      ...completePdf,
      pdf: {
        ...completePdf.pdf!,
        results: {
          ...completePdf.pdf!.results,
          1: { result: { markdown: '# Page one', blocks: [], source: first } },
          2: { result: { markdown: '# Page two', blocks: [], source: second } },
        },
      },
    };
    const { result } = renderHook(() => useImageParse(model));
    act(() => result.current.restore(withSources));
    await act(async () => {});
    expect(result.current.mode).toBe('standard');
    expect(result.current.source).toEqual(second);
    expect(result.current.snapshot?.pdf).toEqual(withSources.pdf);
    act(() => result.current.pdf?.setPage(1));
    expect(result.current.source).toEqual(first);
    act(() => result.current.pdf?.setPage(3));
    expect(result.current.source).toBeUndefined();
    expect(mocks.pdf).not.toHaveBeenCalled();
  });

  it('should clear restored source when opening legacy history without source', async () => {
    const { result } = renderHook(() => useImageParse(model));
    act(() => result.current.restore({ ...cachedImage, source }));
    expect(result.current.source).toEqual(source);
    act(() => result.current.restore(cachedImage));
    await act(async () => {});
    expect(result.current.source).toBeUndefined();
    expect(result.current.markdown).toBe(cachedImage.markdown);
    expect(result.current.snapshot?.source).toBeUndefined();
    expect(mocks.parse).not.toHaveBeenCalled();
  });
  it('印章历史保留流水线模式，不自动走 L2 重识别', async () => {
    const { result } = renderHook(() => useImageParse(model));
    act(() =>
      result.current.restore({
        ...cachedImage,
        mode: 'seal',
        markdown: '印章文字',
      }),
    );
    await act(async () => {});
    expect(result.current.mode).toBe('seal');
    expect(result.current.markdown).toBe('印章文字');
    expect(result.current.snapshot?.mode).toBe('seal');
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.pdf).not.toHaveBeenCalled();
  });
  it('算法标准档历史保留独立模式，不被降级为 LIS 默认档', async () => {
    const { result } = renderHook(() => useImageParse(model));
    act(() =>
      result.current.restore({
        ...cachedImage,
        mode: 'standard-pipeline',
        markdown: '# 算法结果',
      }),
    );
    await act(async () => {});
    expect(result.current.mode).toBe('standard-pipeline');
    expect(result.current.markdown).toBe('# 算法结果');
    expect(result.current.snapshot?.mode).toBe('standard-pipeline');
    expect(mocks.parse).not.toHaveBeenCalled();
  });
  it('信息抽取历史恢复字段，重新识别继续走流水线', async () => {
    const { result } = renderHook(() => useImageParse(model));
    act(() =>
      result.current.restore({
        ...cachedImage,
        mode: 'kie',
        fields: ['店名', '金额'],
        markdown: '{"店名":"面壁智能"}',
      }),
    );
    await act(async () => {});
    expect(result.current.mode).toBe('kie');
    expect(result.current.fields).toEqual(['店名', '金额']);
    expect(result.current.snapshot?.fields).toEqual(['店名', '金额']);
    expect(mocks.parse).not.toHaveBeenCalled();
  });
  it('云端 PDF 未保存裁图时只重建当前页预览，不再次请求 OCR', async () => {
    const image = {
      id: 'image-block',
      kind: 'image' as const,
      label: 'image',
      x: 0,
      y: 0,
      w: 0.5,
      h: 0.5,
      text: '',
      markdown: '![image]()',
      confidence: null,
    };
    const page = { result: { markdown: '![image]()', blocks: [image] } };
    const { result } = renderHook(() => useImageParse(model));
    act(() =>
      result.current.restore({
        ...completePdf,
        pdf: {
          page: 2,
          pages: 3,
          results: { 1: page, 2: page, 3: completePdf.pdf!.results[3] },
        },
      }),
    );
    await waitFor(() => expect(result.current.crops).toEqual(['data:image/png;base64,CACHED']));
    expect(mocks.pdfCrops).toHaveBeenCalledExactlyOnceWith(
      cached.attachment.dataUrl,
      2,
      expect.objectContaining({ markdown: '![image]()' }),
      expect.any(AbortSignal),
    );
    act(() => result.current.pdf?.setPage(1));
    await waitFor(() => expect(mocks.pdfCrops).toHaveBeenCalledTimes(2));
    expect(mocks.pdf).not.toHaveBeenCalled();
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.enabled).not.toHaveBeenCalled();
  });
  it('PDF 裁图重建期间换页，晚到的预览不覆盖新页面', async () => {
    let finish!: (value: string[]) => void;
    mocks.pdfCrops.mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          finish = resolve;
        }),
    );
    const image = {
      kind: 'image' as const,
      label: 'image',
      x: 0,
      y: 0,
      w: 0.5,
      h: 0.5,
      text: '',
      markdown: '![image]()',
      confidence: null,
    };
    const { result } = renderHook(() => useImageParse(model));
    act(() =>
      result.current.restore({
        ...completePdf,
        pdf: {
          ...completePdf.pdf!,
          results: {
            ...completePdf.pdf!.results,
            2: { result: { markdown: '![image]()', blocks: [image] } },
          },
        },
      }),
    );
    await waitFor(() => expect(mocks.pdfCrops).toHaveBeenCalledOnce());
    const signal = mocks.pdfCrops.mock.lastCall?.[3] as AbortSignal;
    act(() => result.current.pdf?.setPage(1));
    expect(signal.aborted).toBe(true);
    await act(async () => {
      finish(['stale']);
    });
    expect(result.current.crops).toEqual([]);
    expect(result.current.markdown).toBe('# Page one');
    expect(mocks.pdf).not.toHaveBeenCalled();
  });
});
