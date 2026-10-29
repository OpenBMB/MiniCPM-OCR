import { createElement, type PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useImageParse } from '../useImageParse';

const mocks = vi.hoisted(() => ({ pipeline: vi.fn(), pdf: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/api/map/imageParsePipeline', () => ({ parseImagePipeline: mocks.pipeline }));
vi.mock('../../utils/pdfImageParse', () => ({ parsePdfPages: mocks.pdf }));
vi.mock('../../utils/imageParseCrops', () => ({ imageParseCrops: async () => [] }));

const image = {
  id: 'manual-image',
  kind: 'image' as const,
  name: 'invoice.png',
  mime: 'image/png',
  size: 12,
  dataUrl: 'data:image/png;base64,AAA',
  fileId: 'file-image',
};
const model = {
  userId: 'user-manual',
  defaultProjectId: 'project-manual',
  imageParseModel: { id: 'minicpm-ocr-aio' },
};

describe('工作台手动识别', () => {
  beforeEach(() => {
    mocks.pipeline.mockReset().mockResolvedValue({ markdown: '结果', blocks: [] });
    mocks.pdf.mockReset().mockResolvedValue(undefined);
  });

  it('图片上传和任务切换都不调用算法，明确开始后才执行', async () => {
    const { result } = renderHook(() => useImageParse(model as never, { autoParse: false }));
    await act(async () => result.current.setAttachment(image));
    expect(mocks.pipeline).not.toHaveBeenCalled();
    await act(async () => result.current.setMode('kie'));
    act(() => result.current.setFields(['发票号码']));
    expect(mocks.pipeline).not.toHaveBeenCalled();
    await act(() => result.current.parse());
    expect(mocks.pipeline).toHaveBeenCalledOnce();
    expect(mocks.pipeline).toHaveBeenCalledWith(expect.objectContaining({ mode: 'kie' }));
  });

  it('切换印章展示后不重新识别且不切换任务', async () => {
    const { result } = renderHook(() => useImageParse(model as never, { autoParse: false }));
    expect(result.current.recognizeSeal).toBe(true);
    await act(async () => result.current.setAttachment(image));
    await act(() => result.current.parse());
    expect(mocks.pipeline).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'standard', recognizeSeal: true, upright: true }),
    );
    act(() => result.current.setRecognizeSeal(false));
    await act(async () => {});
    expect(mocks.pipeline).toHaveBeenCalledOnce();
  });

  it('切换旋转自适应后自动按新方向重新识别', async () => {
    const { result } = renderHook(() => useImageParse(model as never, { autoParse: false }));
    expect(result.current.upright).toBe(true);
    await act(async () => result.current.setAttachment(image));
    await act(() => result.current.parse());
    act(() => result.current.setUpright(false));
    await waitFor(() => expect(mocks.pipeline).toHaveBeenCalledTimes(2));
    expect(mocks.pipeline).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'standard', upright: false }),
    );
  });

  it('PDF 结果后切换旋转会重新识别，切换印章展示不重新识别', async () => {
    mocks.pdf.mockImplementation(async (...args) => {
      const onPage = args[6] as (
        page: number,
        result: { result: { markdown: string; blocks: [] } },
      ) => void;
      onPage(1, { result: { markdown: 'PDF 结果', blocks: [] } });
    });
    const { result } = renderHook(() => useImageParse(model as never, { autoParse: false }));
    await act(async () =>
      result.current.restore({
        attachment: {
          ...image,
          id: 'auto-rerun-pdf',
          kind: 'file',
          name: 'document.pdf',
          mime: 'application/pdf',
          dataUrl: 'data:application/pdf;base64,AAA',
        },
        mode: 'standard',
        markdown: 'PDF 结果',
        layout: [],
        pdf: {
          page: 1,
          pages: 1,
          results: { 1: { result: { markdown: 'PDF 结果', blocks: [] } } },
        },
      }),
    );
    expect(result.current.pdf?.completed).toBe(1);

    await act(async () => result.current.setUpright(false));
    await waitFor(() => expect(mocks.pdf).toHaveBeenCalledOnce());
    expect(mocks.pdf.mock.calls[0]![10]).toBe(false);
    await waitFor(() => expect(result.current.pdf?.completed).toBe(1));

    act(() => result.current.setRecognizeSeal(false));
    await act(async () => {});
    expect(mocks.pdf).toHaveBeenCalledOnce();
  });

  it('自动模式下 PDF 切换印章展示不重新识别', async () => {
    mocks.pdf.mockImplementation(async (...args) => {
      const onPage = args[6] as (
        page: number,
        result: { result: { markdown: string; blocks: [] } },
      ) => void;
      onPage(1, { result: { markdown: 'PDF 结果', blocks: [] } });
    });
    const { result } = renderHook(() => useImageParse(model as never));
    await act(async () =>
      result.current.restore({
        attachment: {
          ...image,
          id: 'auto-mode-pdf',
          kind: 'file',
          name: 'document.pdf',
          mime: 'application/pdf',
          dataUrl: 'data:application/pdf;base64,AAA',
        },
        mode: 'standard',
        markdown: 'PDF 结果',
        layout: [],
        pdf: {
          page: 1,
          pages: 1,
          results: { 1: { result: { markdown: 'PDF 结果', blocks: [] } } },
        },
      }),
    );
    expect(result.current.pdf?.completed).toBe(1);

    await act(async () => result.current.setRecognizeSeal(false));
    await act(async () => {});
    expect(mocks.pdf).not.toHaveBeenCalled();
  });

  it('PDF 启动时固定将印章识别开启传到逐页识别器', async () => {
    const { result } = renderHook(() => useImageParse(model as never, { autoParse: false }));
    act(() => result.current.setRecognizeSeal(false));
    await act(async () =>
      result.current.setAttachment({
        ...image,
        id: 'seal-option-pdf',
        kind: 'file',
        name: 'document.pdf',
        mime: 'application/pdf',
        dataUrl: 'data:application/pdf;base64,AAA',
      }),
    );
    await act(() => result.current.parse());
    await waitFor(() => expect(mocks.pdf).toHaveBeenCalledOnce());
    expect(mocks.pdf.mock.calls[0]!.slice(10, 12)).toEqual([true, true]);
    expect(mocks.pdf.mock.calls[0]![12]).toMatchObject({ fileId: 'file-image' });
  });

  it('开始提取直接提交配置草稿，不使用上一轮字段', async () => {
    const { result } = renderHook(() => useImageParse(model as never, { autoParse: false }));
    await act(async () => result.current.setAttachment(image));
    await act(async () => result.current.setMode('kie'));
    act(() => result.current.setFields(['旧字段']));
    await act(() => result.current.parse({ fields: ['合同编号', '甲方'] }));
    expect(mocks.pipeline).toHaveBeenCalledWith(
      expect.objectContaining({ fields: ['合同编号', '甲方'] }),
    );
    expect(result.current.fields).toEqual(['合同编号', '甲方']);
  });

  it('成功但没有文字仍标记已完成，不能再显示尚未开始', async () => {
    mocks.pipeline.mockResolvedValueOnce({ markdown: '', blocks: [] });
    const { result } = renderHook(() => useImageParse(model as never, { autoParse: false }));
    await act(async () => result.current.setAttachment(image));
    await act(() => result.current.parse());
    expect(result.current.finished).toBe(true);
    expect(result.current.markdown).toBe('');
  });

  it('更换文件清理上一文件的字段配置', async () => {
    const { result } = renderHook(() => useImageParse(model as never, { autoParse: false }));
    await act(async () => result.current.setAttachment(image));
    act(() => result.current.setFields(['原文件字段']));
    await act(async () => result.current.setAttachment({ ...image, id: 'next-image' }));
    expect(result.current.fields).toEqual([]);
    expect(mocks.pipeline).not.toHaveBeenCalled();
  });

  it('无文字的成功结果在切换任务后仍保持已完成', async () => {
    mocks.pipeline.mockResolvedValueOnce({ markdown: '', blocks: [] });
    const { result } = renderHook(() => useImageParse(model as never, { autoParse: false }));
    await act(async () => result.current.setAttachment(image));
    await act(() => result.current.parse());
    await act(async () => result.current.setMode('kie'));
    await act(async () => result.current.setMode('standard'));
    expect(result.current.finished).toBe(true);
    expect(mocks.pipeline).toHaveBeenCalledOnce();
  });

  it('PDF 上传后仅预览，手动开始才逐页识别', async () => {
    const { result } = renderHook(() => useImageParse(model as never, { autoParse: false }));
    await act(async () =>
      result.current.setAttachment({
        ...image,
        id: 'manual-pdf',
        kind: 'file',
        name: 'document.pdf',
        mime: 'application/pdf',
        dataUrl: 'data:application/pdf;base64,AAA',
      }),
    );
    expect(mocks.pdf).not.toHaveBeenCalled();
    await act(() => result.current.parse());
    await waitFor(() => expect(mocks.pdf).toHaveBeenCalledOnce());
  });

  it('打开未完成历史不自动消费模型调用', async () => {
    const { result } = renderHook(() => useImageParse(model as never, { autoParse: false }));
    await act(async () =>
      result.current.restore({
        attachment: image,
        mode: 'standard',
        markdown: '',
        layout: [],
      }),
    );
    expect(mocks.pipeline).not.toHaveBeenCalled();
    expect(result.current.attachment?.id).toBe(image.id);
  });

  it('全文和字段结果可来回切换，切换不产生新请求', async () => {
    mocks.pipeline
      .mockResolvedValueOnce({ markdown: '全文结果', blocks: [] })
      .mockResolvedValueOnce({ markdown: '{"发票号码":"12345"}', blocks: [] });
    const { result } = renderHook(() => useImageParse(model as never, { autoParse: false }));
    await act(async () => result.current.setAttachment(image));
    await act(() => result.current.parse());
    const textKey = result.current.resultKey;
    expect(result.current.markdown).toBe('全文结果');
    await act(async () => result.current.setMode('kie'));
    act(() => result.current.setFields(['发票号码']));
    await act(() => result.current.parse());
    const kieKey = result.current.resultKey;
    expect(result.current.markdown).toBe('{"发票号码":"12345"}');
    await act(async () => result.current.setMode('standard'));
    expect(result.current.markdown).toBe('全文结果');
    expect(result.current.resultKey).toBe(textKey);
    await act(async () => result.current.setMode('kie'));
    expect(result.current.markdown).toBe('{"发票号码":"12345"}');
    expect(result.current.fields).toEqual(['发票号码']);
    expect(result.current.resultKey).toBe(kieKey);
    expect(mocks.pipeline).toHaveBeenCalledTimes(2);
  });

  it('PDF 切换到字段任务后可返回原结果，不重新识别', async () => {
    const { result } = renderHook(() => useImageParse(model as never, { autoParse: false }));
    await act(async () =>
      result.current.restore({
        attachment: {
          ...image,
          id: 'saved-pdf',
          kind: 'file',
          name: 'doc.pdf',
          mime: 'application/pdf',
          dataUrl: 'data:application/pdf;base64,AAA',
        },
        mode: 'standard',
        markdown: 'PDF 全文',
        layout: [],
        pdf: {
          page: 1,
          pages: 1,
          results: { 1: { result: { markdown: 'PDF 全文', blocks: [] } } },
        },
      }),
    );
    await act(async () => result.current.setMode('kie'));
    expect(result.current.canParse).toBe(true);
    await act(async () => result.current.setMode('standard'));
    expect(result.current.markdown).toBe('PDF 全文');
    expect(mocks.pdf).not.toHaveBeenCalled();
    expect(mocks.pipeline).not.toHaveBeenCalled();
  });

  it('PDF 信息抽取先配置字段，开始时传递原件 fileId 和最新字段草稿', async () => {
    const { result } = renderHook(() => useImageParse(model as never, { autoParse: false }));
    await act(async () =>
      result.current.setAttachment({
        ...image,
        id: 'kie-pdf',
        kind: 'file',
        mime: 'application/pdf',
        name: 'contract.pdf',
        dataUrl: 'blob:contract',
      }),
    );
    await act(async () => result.current.setMode('kie'));
    expect(result.current.blockedReason).toBeUndefined();
    await act(() => result.current.parse({ fields: ['合同编号', '甲方'] }));
    await waitFor(() => expect(mocks.pdf).toHaveBeenCalledOnce());
    const args = mocks.pdf.mock.calls[0]!;
    expect(args[1]).toBe('kie');
    expect(args[12]).toMatchObject({ fileId: 'file-image', dataUrl: 'blob:contract' });
    expect(args[13]).toMatchObject({ fields: ['合同编号', '甲方'] });
    expect(result.current.fields).toEqual(['合同编号', '甲方']);
    expect(mocks.pipeline).not.toHaveBeenCalled();
  });

  it('PDF 信息抽取字段非法时不创建任务', async () => {
    const { result } = renderHook(() => useImageParse(model as never, { autoParse: false }));
    await act(async () =>
      result.current.setAttachment({
        ...image,
        kind: 'file',
        mime: 'application/pdf',
        name: 'contract.pdf',
      }),
    );
    await act(async () => result.current.setMode('kie'));
    await act(() => result.current.parse({ fields: [] }));
    expect(result.current.error).toBe('imageParseKieFieldsRequired');
    expect(mocks.pdf).not.toHaveBeenCalled();
  });

  it('KIE PDF 进度、任务切换与历史恢复保留逐页结果', async () => {
    const { result } = renderHook(() => useImageParse(model as never, { autoParse: false }));
    await act(async () =>
      result.current.setAttachment({
        ...image,
        id: 'kie-history-pdf',
        kind: 'file',
        mime: 'application/pdf',
        name: 'contract.pdf',
        dataUrl: 'data:application/pdf;base64,AAA',
      }),
    );
    await act(async () => result.current.setMode('kie'));
    mocks.pdf.mockImplementation(async (...args) => {
      args[5](2);
      args[6](1, { result: { markdown: '{"合同编号":"123"}', blocks: [] } });
      args[6](2, { result: { markdown: '{"合同编号":"456"}', blocks: [] } });
    });
    await act(() => result.current.parse({ fields: ['合同编号'] }));
    await waitFor(() => expect(result.current.pdf?.completed).toBe(2));
    expect(result.current.markdown).toBe('{"合同编号":"123"}');
    const saved = result.current.snapshot;
    expect(saved).toMatchObject({ mode: 'kie', fields: ['合同编号'], pdf: { pages: 2 } });
    await act(async () => result.current.setMode('standard'));
    await act(async () => result.current.setMode('kie'));
    expect(result.current.markdown).toBe('{"合同编号":"123"}');
    expect(mocks.pdf).toHaveBeenCalledOnce();
    act(() => result.current.pdf?.retryPage(2));
    await waitFor(() => expect(mocks.pdf).toHaveBeenCalledTimes(2));
    expect(mocks.pdf.mock.calls[1]![7]).toBe(2);
    expect(mocks.pdf.mock.calls[1]![13]).toMatchObject({ fields: ['合同编号'] });
  });

  it('图片和 PDF 复用门户 QueryClient，不读取 API Key 或提交本地预览', async () => {
    const client = new QueryClient();
    const getSecret = vi.fn(() => {
      throw new Error('must not read a key');
    });
    const { result, unmount } = renderHook(
      () =>
        useImageParse(
          {
            ...model,
            imageParseModel: { id: 'minicpm-ocr-1.0' },
            getSecret,
            hasKeys: false,
          } as never,
          { autoParse: false },
        ),
      {
        wrapper: ({ children }: PropsWithChildren) =>
          createElement(QueryClientProvider, { client }, children),
      },
    );
    await act(async () => result.current.setAttachment(image));
    await act(() => result.current.parse());
    expect(mocks.pipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        queryClient: client,
        fileId: 'file-image',
        model: 'minicpm-ocr-1.0',
      }),
    );
    const input = mocks.pipeline.mock.calls[0]![0];
    for (const field of ['image', 'fileUrl', 'secret', 'apiKey'])
      expect(input).not.toHaveProperty(field);
    await act(async () =>
      result.current.setAttachment({
        ...image,
        kind: 'file',
        mime: 'application/pdf',
        dataUrl: 'blob:original',
      }),
    );
    await act(() => result.current.parse());
    await waitFor(() => expect(mocks.pdf).toHaveBeenCalledOnce());
    expect(mocks.pdf.mock.calls[0]![13]).toEqual({ queryClient: client });
    expect(getSecret).not.toHaveBeenCalled();
    unmount();
    client.clear();
  });

  it('停止单图任务会中止其 signal，晚到响应不能覆盖结果', async () => {
    let finish!: (value: { markdown: string; blocks: [] }) => void;
    mocks.pipeline.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useImageParse(model as never, { autoParse: false }));
    await act(async () => result.current.setAttachment(image));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.parse();
    });
    await waitFor(() => expect(mocks.pipeline).toHaveBeenCalledOnce());
    const signal = mocks.pipeline.mock.calls[0]![0].signal as AbortSignal;
    act(() => result.current.stop());
    expect(signal.aborted).toBe(true);
    await act(async () => {
      finish({ markdown: 'stale', blocks: [] });
      await pending;
    });
    expect(result.current.markdown).toBe('');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('imageParseStopped');
  });
});
