import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useImageParse } from '../useImageParse';
import type { ImageParseSnapshot } from '../../utils/imageParseHistoryTypes';
import type { ImageParseRotationInfo } from '../../utils/imageParseSample';

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  pipeline: vi.fn(),
  pdf: vi.fn(),
  crops: vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/api/map/imageParseV2', () => ({
  imageParseV2Enabled: vi.fn(),
  parseImageV2: mocks.parse,
}));
vi.mock('@/api/map/imageParsePipeline', () => ({ parseImagePipeline: mocks.pipeline }));
vi.mock('../../utils/pdfImageParse', () => ({ parsePdfPages: mocks.pdf }));
vi.mock('../../utils/imageParseCrops', () => ({ imageParseCrops: mocks.crops }));
vi.mock('../../utils/pdfImageParseCrops', () => ({
  rebuildPdfPageCrops: vi.fn().mockResolvedValue([]),
}));

const model = {
  userId: 'u',
  defaultProjectId: 'p',
  imageParseModel: { id: 'minicpm-ocr-aio' },
  getSecret: () => 'local-test-secret',
} as never;
const rotation = (totalAngle: number): ImageParseRotationInfo => ({
  enabled: true,
  applied: true,
  totalAngle,
  predictedAngle: totalAngle,
  predictedScore: 0.97,
  confirmed: true,
  orientationAngle: totalAngle,
  deskewAngle: 0,
  skippedReason: null,
});
const snapshot: ImageParseSnapshot = {
  attachment: {
    id: 'image',
    kind: 'image',
    name: 'scan.png',
    mime: 'image/png',
    size: 12,
    dataUrl: 'https://files.example/signed.png',
    fileId: 'file_image',
  },
  mode: 'standard',
  markdown: '# Saved',
  layout: [],
  rotation: rotation(-90),
};

describe('工作台历史旋转恢复', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.crops.mockResolvedValue([]);
  });

  it('签链原图尚未下载时先恢复文字及摆正角度，不触发识别', async () => {
    const { result } = renderHook(() =>
      useImageParse(model, { autoParse: false, autoParseOnUpload: true }),
    );
    act(() => expect(result.current.restore(snapshot)).toBe(true));
    await act(async () => {});
    expect(result.current.markdown).toBe('# Saved');
    expect(result.current.rotation).toEqual(snapshot.rotation);
    expect(result.current.snapshot?.rotation).toEqual(snapshot.rotation);
    expect(result.current.loading).toBe(false);
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.pipeline).not.toHaveBeenCalled();
  });

  it('PDF 历史保留每页独立角度，失败页不会因为打开历史被重新识别', async () => {
    const { result } = renderHook(() =>
      useImageParse(model, { autoParse: false, autoParseOnUpload: true }),
    );
    const pdf: ImageParseSnapshot = {
      ...snapshot,
      attachment: {
        ...snapshot.attachment,
        kind: 'file',
        name: 'scan.pdf',
        mime: 'application/pdf',
        dataUrl: 'https://files.example/signed.pdf',
      },
      pdf: {
        page: 2,
        pages: 3,
        results: {
          1: { result: { markdown: 'One', blocks: [], rotation: rotation(-90) } },
          2: { result: { markdown: 'Two', blocks: [], rotation: rotation(180) } },
          3: { error: 'imageParseRequestFailed' },
        },
      },
    };
    act(() => expect(result.current.restore(pdf)).toBe(true));
    expect(result.current.rotation).toEqual(rotation(180));
    act(() => result.current.pdf?.setPage(1));
    expect(result.current.rotation).toEqual(rotation(-90));
    act(() => result.current.pdf?.setPage(3));
    await act(async () => {});
    expect(result.current.rotation).toBeUndefined();
    expect(mocks.pdf).not.toHaveBeenCalled();
    expect(mocks.pipeline).not.toHaveBeenCalled();
  });

  it('旧图片历史没有角度时清除上一张的摆正信息，空结果也不自动重识别', async () => {
    const { result } = renderHook(() =>
      useImageParse(model, { autoParse: false, autoParseOnUpload: true }),
    );
    act(() => result.current.restore(snapshot));
    act(() => result.current.restore({ ...snapshot, rotation: undefined }));
    expect(result.current.rotation).toBeUndefined();
    act(() =>
      result.current.restore({ ...snapshot, markdown: '', layout: [], rotation: undefined }),
    );
    await act(async () => {});
    expect(result.current.markdown).toBe('');
    expect(result.current.loading).toBe(false);
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.pipeline).not.toHaveBeenCalled();
  });
});
