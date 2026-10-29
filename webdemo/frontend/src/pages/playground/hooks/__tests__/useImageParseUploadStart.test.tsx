import { StrictMode, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useImageParse } from '../useImageParse';

const mocks = vi.hoisted(() => ({ pipeline: vi.fn(), pdf: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/api/map/imageParsePipeline', () => ({ parseImagePipeline: mocks.pipeline }));
vi.mock('../../utils/pdfImageParse', () => ({ parsePdfPages: mocks.pdf }));
vi.mock('../../utils/imageParseCrops', () => ({ imageParseCrops: async () => [] }));

const image = {
  id: 'upload-image',
  kind: 'image' as const,
  name: 'scan.png',
  mime: 'image/png',
  size: 12,
  dataUrl: 'data:image/png;base64,AAA',
  fileId: 'uploaded-file',
};
const model = {
  userId: 'upload-user',
  defaultProjectId: 'upload-project',
  imageParseModel: { id: 'minicpm-ocr-aio' },
};
const options = { autoParse: false, autoParseOnUpload: true };
const pdf = {
  ...image,
  id: 'upload-pdf',
  kind: 'file' as const,
  name: 'scan.pdf',
  mime: 'application/pdf',
  dataUrl: 'data:application/pdf;base64,AAA',
};

describe('全文识别仅在上传完成后自动启动', () => {
  beforeEach(() => {
    mocks.pipeline.mockReset().mockResolvedValue({ markdown: '全文结果', blocks: [] });
    mocks.pdf.mockReset().mockResolvedValue(undefined);
  });

  it('图片上传完成自动识别一次，重新渲染不重复请求', async () => {
    const { result, rerender } = renderHook(() => useImageParse(model as never, options), {
      wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
    });
    await act(async () => result.current.setAttachment(image));
    await waitFor(() => expect(result.current.markdown).toBe('全文结果'));
    rerender();
    expect(mocks.pipeline).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ fileId: 'uploaded-file', mode: 'standard', upright: true }),
    );
  });

  it('PDF 上传完成自动开始逐页识别', async () => {
    const { result } = renderHook(() => useImageParse(model as never, options));
    await act(async () => result.current.setAttachment(pdf));
    await waitFor(() => expect(mocks.pdf).toHaveBeenCalledOnce());
    expect(mocks.pipeline).not.toHaveBeenCalled();
  });

  it('字段提取上传及配置字段均不自动执行，切到全文也不消费新请求', async () => {
    const { result } = renderHook(() => useImageParse(model as never, options));
    await act(async () => result.current.setMode('kie'));
    await act(async () => result.current.setAttachment(image));
    await act(async () => result.current.setFields(['发票号码']));
    expect(mocks.pipeline).not.toHaveBeenCalled();
    await act(async () => result.current.setMode('standard'));
    expect(mocks.pipeline).not.toHaveBeenCalled();
    await act(() => result.current.parse());
    expect(mocks.pipeline).toHaveBeenCalledOnce();
  });

  it('字段提取入口从首次渲染即固定任务，上传不误发全文识别请求', async () => {
    const { result } = renderHook(() =>
      useImageParse(model as never, { ...options, initialMode: 'kie' }),
    );
    expect(result.current.mode).toBe('kie');
    await act(async () => result.current.setAttachment(image));
    act(() => result.current.setFields(['发票号码']));
    expect(mocks.pipeline).not.toHaveBeenCalled();
    await act(() => result.current.parse());
    expect(mocks.pipeline).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ mode: 'kie', fields: ['发票号码'] }),
    );
  });

  it('浏览未完成图片或 PDF 历史不自动调用算法', async () => {
    const { result } = renderHook(() => useImageParse(model as never, options));
    await act(async () =>
      result.current.restore({ attachment: image, mode: 'standard', markdown: '', layout: [] }),
    );
    await act(async () =>
      result.current.restore({
        attachment: pdf,
        mode: 'standard',
        markdown: '',
        layout: [],
        pdf: { page: 1, pages: 1, results: {} },
      }),
    );
    expect(mocks.pipeline).not.toHaveBeenCalled();
    expect(mocks.pdf).not.toHaveBeenCalled();
  });

  it('自动识别失败后等待用户重试，不形成自动重试循环', async () => {
    mocks.pipeline.mockRejectedValueOnce(new Error('imageParseRequestFailed'));
    const { result, rerender } = renderHook(() => useImageParse(model as never, options));
    await act(async () => result.current.setAttachment(image));
    await waitFor(() => expect(result.current.error).toBe('imageParseRequestFailed'));
    rerender();
    expect(mocks.pipeline).toHaveBeenCalledOnce();
    await act(() => result.current.parse());
    expect(result.current.markdown).toBe('全文结果');
    expect(mocks.pipeline).toHaveBeenCalledTimes(2);
  });

  it('新文件自动识别，来回切换全文和字段任务仍复用结果', async () => {
    const { result } = renderHook(() => useImageParse(model as never, options));
    await act(async () => result.current.setAttachment(image));
    await waitFor(() => expect(result.current.finished).toBe(true));
    await act(async () => result.current.setMode('kie'));
    await act(async () => result.current.setMode('standard'));
    expect(result.current.markdown).toBe('全文结果');
    expect(mocks.pipeline).toHaveBeenCalledOnce();
    await act(async () =>
      result.current.setAttachment({ ...image, id: 'new-upload', fileId: 'new-file' }),
    );
    await waitFor(() => expect(mocks.pipeline).toHaveBeenCalledTimes(2));
    expect(mocks.pipeline).toHaveBeenLastCalledWith(
      expect.objectContaining({ fileId: 'new-file' }),
    );
  });
});
