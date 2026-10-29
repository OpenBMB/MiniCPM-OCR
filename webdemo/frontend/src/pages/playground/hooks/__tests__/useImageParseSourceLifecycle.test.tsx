import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useImageParse } from '../useImageParse';

const mocks = vi.hoisted(() => ({
  pipeline: vi.fn(),
  crops: vi.fn(),
  pdf: vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/api/map/imageParsePipeline', () => ({
  parseImagePipeline: mocks.pipeline,
}));
vi.mock('../../utils/imageParseCrops', () => ({ imageParseCrops: mocks.crops }));
vi.mock('../../utils/pdfImageParse', () => ({ parsePdfPages: mocks.pdf }));

const image = {
  id: 'image',
  kind: 'image' as const,
  name: 'scan.png',
  mime: 'image/png',
  size: 12,
  dataUrl: 'data:image/png;base64,AAA',
  fileId: 'file-image',
};
const model = {
  userId: 'u',
  defaultProjectId: 'p',
  imageParseModel: { id: 'minicpm-ocr-aio' },
  getSecret: () => 'plain-secret',
};

describe('useImageParse algorithm pipeline lifecycle', () => {
  beforeEach(() => {
    mocks.pipeline.mockReset().mockResolvedValue({ markdown: '# OCR result', blocks: [] });
    mocks.crops.mockReset().mockResolvedValue([]);
    mocks.pdf.mockReset().mockImplementation(() => new Promise(() => {}));
  });

  it('算法服务返回结果时不生成旧的重算 source', async () => {
    const { result } = renderHook(() => useImageParse(model as never));
    await act(async () => result.current.setAttachment(image));
    await waitFor(() => expect(result.current.markdown).toBe('# OCR result'));
    expect(result.current.source).toBeUndefined();
    expect(result.current.snapshot?.source).toBeUndefined();
    expect(mocks.pipeline).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'file-image', mode: 'standard' }),
    );
  });

  it('替换附件或清空时立即清理旧结果和 source', async () => {
    const { result } = renderHook(() => useImageParse(model as never));
    await act(async () => result.current.setAttachment(image));
    await waitFor(() => expect(result.current.markdown).toBe('# OCR result'));
    mocks.pipeline.mockImplementation(() => new Promise(() => undefined));
    await act(async () => result.current.setAttachment({ ...image, id: 'replacement' }));
    expect(result.current.source).toBeUndefined();
    expect(result.current.markdown).toBe('');
    act(() => result.current.clear());
    expect(result.current.source).toBeUndefined();
    expect(result.current.attachment).toBeUndefined();
  });

  it('算法服务失败时不保留上一次结果的 source', async () => {
    const { result } = renderHook(() => useImageParse(model as never));
    await act(async () => result.current.setAttachment(image));
    await waitFor(() => expect(result.current.markdown).toBe('# OCR result'));
    mocks.pipeline.mockRejectedValue(new Error('imageParseRequestFailed'));
    act(() => void result.current.parse());
    await waitFor(() => expect(result.current.error).toBe('imageParseRequestFailed'));
    expect(result.current.source).toBeUndefined();
    expect(result.current.snapshot?.source).toBeUndefined();
  });

  it('PDF 当前页结果也不暴露旧 source', async () => {
    mocks.pdf.mockImplementation(
      async (_source, _mode, _model, _project, _signal, onOpen, onPage) => {
        onOpen(1);
        onPage(1, { result: { markdown: '# PDF', blocks: [] } });
      },
    );
    const { result } = renderHook(() => useImageParse(model as never));
    await act(async () =>
      result.current.setAttachment({
        ...image,
        id: 'pdf',
        kind: 'file',
        name: 'scan.pdf',
        mime: 'application/pdf',
        dataUrl: 'data:application/pdf;base64,AAA',
      }),
    );
    await waitFor(() => expect(result.current.markdown).toBe('# PDF'));
    expect(result.current.source).toBeUndefined();
    expect(result.current.pdf?.current?.result?.source).toBeUndefined();
  });
});
