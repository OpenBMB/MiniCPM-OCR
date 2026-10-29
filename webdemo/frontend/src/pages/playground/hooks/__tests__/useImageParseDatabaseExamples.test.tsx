import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useImageParse } from '../useImageParse';
import type { ImageParseSnapshot } from '../../utils/imageParseHistoryTypes';

const mocks = vi.hoisted(() => ({ pipeline: vi.fn(), pdf: vi.fn(), crops: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/api/map/imageParsePipeline', () => ({ parseImagePipeline: mocks.pipeline }));
vi.mock('../../utils/pdfImageParse', () => ({ parsePdfPages: mocks.pdf }));
vi.mock('../../utils/imageParseCrops', () => ({ imageParseCrops: mocks.crops }));

const model = {
  userId: 'user',
  defaultProjectId: 'project',
  imageParseModel: { id: 'minicpm-ocr-aio' },
  getSecret: () => 'test-secret',
} as never;
const snapshot: ImageParseSnapshot = {
  attachment: {
    id: 'example:physics',
    kind: 'image',
    name: '手写课堂笔记.png',
    mime: 'image/png',
    size: 3,
    dataUrl: 'data:image/png;base64,AQID',
  },
  mode: 'scored',
  markdown: '数据库预采集正文',
  layout: [
    {
      id: 'captured-block',
      kind: 'text',
      x: 0.1,
      y: 0.2,
      w: 0.6,
      h: 0.1,
      text: '数据库预采集正文',
      markdown: '数据库预采集正文',
      confidence: 0.73,
    },
  ],
};

describe('共享案例只展示数据库预采集结果', () => {
  beforeEach(() => {
    mocks.pipeline.mockReset();
    mocks.pdf.mockReset();
    mocks.crops.mockReset().mockResolvedValue([]);
  });

  it('只有原件而无数据库结果时不生成模拟正文或进度，也不请求 OCR', async () => {
    const { result } = renderHook(() => useImageParse(model));
    await act(async () => result.current.setAttachment(snapshot.attachment));
    expect(result.current.loading).toBe(false);
    expect(result.current.progress).toBeNull();
    expect(result.current.markdown).toBe('');
    expect(result.current.canParse).toBe(false);
    await act(() => result.current.parse());
    expect(mocks.pipeline).not.toHaveBeenCalled();
    expect(mocks.pdf).not.toHaveBeenCalled();
  });

  it('保留数据库正文、坐标和真实分数，不能重识别或通过模式切换覆盖', async () => {
    const { result } = renderHook(() => useImageParse(model));
    await act(async () => expect(result.current.restore(snapshot)).toBe(true));
    await act(async () => {
      result.current.setMode('high-precision');
      await result.current.parse();
    });
    expect(result.current.markdown).toBe(snapshot.markdown);
    expect(result.current.layout).toEqual(snapshot.layout);
    expect(result.current.mode).toBe('standard');
    expect(result.current.progress).toBeNull();
    expect(result.current.snapshot).toBeNull();
    expect(mocks.pipeline).not.toHaveBeenCalled();
  });

  it('共享 PDF 恢复全部数据库页，切页不触发 OCR，也不写入个人历史', async () => {
    const pdf: ImageParseSnapshot = {
      ...snapshot,
      attachment: {
        id: 'example:agreement',
        kind: 'file',
        name: '商务合作框架协议.pdf',
        mime: 'application/pdf',
        size: 883_513,
        dataUrl: 'data:application/pdf;base64,AQID',
      },
      pdf: {
        page: 1,
        pages: 2,
        results: {
          1: { result: { markdown: '数据库第1页', blocks: snapshot.layout } },
          2: { result: { markdown: '数据库第2页', blocks: snapshot.layout } },
        },
      },
    };
    const { result, rerender } = renderHook(
      ({ secret }) =>
        useImageParse({
          userId: 'user',
          defaultProjectId: 'project',
          imageParseModel: { id: 'minicpm-ocr-aio' },
          getSecret: () => secret,
        } as never),
      { initialProps: { secret: 'test-secret' } },
    );
    await act(async () => expect(result.current.restore(pdf)).toBe(true));
    expect(result.current.pdf?.pages).toBe(2);
    expect(result.current.markdown).toBe('数据库第1页');
    await act(async () => result.current.pdf?.setPage(2));
    expect(result.current.markdown).toBe('数据库第2页');
    expect(result.current.layout).toEqual(snapshot.layout);
    rerender({ secret: 'another-test-secret' });
    expect(result.current.pdf?.pages).toBe(2);
    expect(result.current.markdown).toBe('数据库第2页');
    expect(result.current.snapshot).toBeNull();
    expect(mocks.pdf).not.toHaveBeenCalled();
    expect(mocks.pipeline).not.toHaveBeenCalled();
  });
});
