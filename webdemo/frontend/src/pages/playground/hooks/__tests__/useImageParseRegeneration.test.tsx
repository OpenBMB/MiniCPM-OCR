import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IMAGE_PARSE_SAMPLE_BLOCKS } from '../../utils/__tests__/imageParseSampleFixtures';
import type { ImageParseSource } from '@/api/map/imageParseSource';
import type { ImageParseRegenerateResult } from '@/api/map/imageParseSdk';

const mocks = vi.hoisted(() => ({ regenerate: vi.fn() }));
vi.mock('@/api/map/imageParseV2', () => ({ regenerateImageParseV4: mocks.regenerate }));
import { useImageParseDraft } from '../useImageParseDraft';
import { useImageParseRegeneration } from '../useImageParseRegeneration';

const block = {
  ...IMAGE_PARSE_SAMPLE_BLOCKS[2],
  id: 'low',
  markdown: '原文',
  text: '原文',
  confidence: 0.4,
};
const source: ImageParseSource = {
  requestId: 'e74bb0e0b8d04587afb4d53412ef5e69',
  model: 'minicpm-ocr-aio',
  pageIndex: 0,
  createdAt: 1_800_000_000,
  expiresAt: 1_800_086_400,
  token: 'signed-source.signature',
};

function useSubject(key = 'task') {
  const draft = useImageParseDraft('原文', key, new Map([['low', { start: 0, end: 2 }]]));
  const regenerate = useImageParseRegeneration({
    resultKey: key,
    model: 'minicpm-ocr-aio',
    secret: 'plain-secret',
    blocks: [block],
    draft,
    source,
    loading: false,
    documentDataUrl: 'data:image/png;base64,AAA',
    mime: 'image/png',
    pageIndex: 0,
  });
  return { draft, regenerate };
}

beforeEach(() => {
  mocks.regenerate.mockReset();
});

describe('主动块重生成生命周期', () => {
  it('批量计数与执行只包括可映射未编辑的有效低分文本，不受列表展示上限影响', async () => {
    mocks.regenerate.mockResolvedValue({ markdown: '新文', confidence: 0.9 });
    const blocks = Array.from({ length: 45 }, (_, order) => ({
      ...block,
      id: `low-${order}`,
      order,
      text: `原文${order}`,
      markdown: `原文${order}`,
    }));
    const extras = [
      { ...block, id: 'high', confidence: 0.9 },
      { ...block, id: 'missing', confidence: null },
      { ...block, id: 'unmapped' },
      { ...block, id: 'edited' },
      { ...block, id: 'image', kind: 'image' as const },
    ];
    const initial = blocks.map((item) => item.markdown).join('\n\n') + '\n\n人工内容';
    const ranges = new Map(
      blocks.map((item) => [
        item.id,
        {
          start: initial.indexOf(item.markdown + '\n'),
          end: initial.indexOf(item.markdown + '\n') + item.markdown.length,
        },
      ]),
    );
    ranges.set('edited', { start: initial.indexOf('人工内容'), end: initial.length });
    const { result } = renderHook(() => {
      const draft = useImageParseDraft(initial, 'batch-45', ranges);
      const regenerate = useImageParseRegeneration({
        resultKey: 'batch-45',
        model: 'minicpm-ocr-aio',
        secret: 'plain-secret',
        blocks: [...blocks, ...extras],
        draft,
        source,
        documentDataUrl: 'data:image/png;base64,AAA',
        mime: 'image/png',
        pageIndex: 0,
        loading: false,
      });
      return { draft, regenerate };
    });
    expect(result.current.regenerate.eligibleLowCount).toBe(45);
    await act(async () => result.current.regenerate.regenerateLowBlocks());
    expect(result.current.draft.value).toBe(Array(45).fill('新文').join('\n\n') + '\n\n人工内容');
    expect(result.current.regenerate.eligibleLowCount).toBe(0);
    expect(mocks.regenerate).toHaveBeenCalledTimes(45);
  });
  it('缺少 LIS 来源证明时不可用，也不允许本地算法兜底', async () => {
    const { result } = renderHook(() => {
      const draft = useImageParseDraft(
        '原文',
        'missing-source',
        new Map([['low', { start: 0, end: 2 }]]),
      );
      const regenerate = useImageParseRegeneration({
        resultKey: 'missing-source',
        model: 'minicpm-ocr-aio',
        secret: 'plain-secret',
        blocks: [block],
        draft,
        loading: false,
        documentDataUrl: 'data:image/png;base64,AAA',
        mime: 'image/png',
        pageIndex: 0,
      });
      return { draft, regenerate };
    });
    expect(result.current.regenerate.available).toBe(false);
    await act(async () => result.current.regenerate.regenerateBlock('low'));
    expect(result.current.draft.value).toBe('原文');
    expect(mocks.regenerate).not.toHaveBeenCalled();
  });

  it('成功后自动更新草稿与分数，同时保留原始版本', async () => {
    mocks.regenerate.mockResolvedValue({ markdown: '新文', confidence: 0.9 });
    const { result } = renderHook(() => useSubject());
    await act(async () => result.current.regenerate.regenerateBlock('low'));
    expect(result.current.draft.value).toBe('新文');
    expect(result.current.regenerate.layout[0].confidence).toBe(0.9);
    expect(result.current.regenerate.results.low.original.markdown).toBe('原文');
    expect(mocks.regenerate).toHaveBeenCalledWith(
      source,
      block,
      expect.any(AbortSignal),
      'minicpm-ocr-aio',
      'plain-secret',
    );
  });

  it('已编辑目标块不请求、不覆盖人工内容', async () => {
    mocks.regenerate.mockResolvedValue({ markdown: '新文', confidence: 0.9 });
    const { result } = renderHook(() => useSubject());
    act(() => result.current.draft.setValue('人工内容'));
    await act(async () => result.current.regenerate.regenerateBlock('low'));
    expect(mocks.regenerate).not.toHaveBeenCalled();
    expect(result.current.draft.value).toBe('人工内容');
  });

  it('切换文档后旧返回不修改新草稿', async () => {
    let resolve!: (value: { markdown: string; confidence: number }) => void;
    mocks.regenerate.mockImplementation(
      () =>
        new Promise<ImageParseRegenerateResult>((done) => {
          resolve = done;
        }),
    );
    const { result, rerender } = renderHook(({ key }) => useSubject(key), {
      initialProps: { key: 'old' },
    });
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.regenerate.regenerateBlock('low');
    });
    rerender({ key: 'new' });
    await act(async () => {
      resolve({ markdown: '旧返回', confidence: 0.9 });
      await pending;
    });
    expect(result.current.draft.value).toBe('原文');
    expect(result.current.regenerate.results).toEqual({});
  });

  it('等待期间人工修改目标块，不覆盖也不更新其分数', async () => {
    let resolve!: (value: { markdown: string; confidence: number }) => void;
    mocks.regenerate.mockImplementation(
      () =>
        new Promise<ImageParseRegenerateResult>((done) => {
          resolve = done;
        }),
    );
    const { result } = renderHook(() => useSubject());
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.regenerate.regenerateBlock('low');
    });
    act(() => result.current.draft.setValue('人工保留'));
    await act(async () => {
      resolve({ markdown: '模型返回', confidence: 0.9 });
      await pending;
    });
    expect(result.current.draft.value).toBe('人工保留');
    expect(result.current.regenerate.layout[0].confidence).toBe(0.4);
    expect(result.current.regenerate.results.low.error).toBe('imageParseRegenerateEdited');
  });

  it('PDF 切页后返回原页保留最优分数及两版结果', async () => {
    mocks.regenerate.mockResolvedValue({ markdown: '新文', confidence: 0.9 });
    const { result, rerender } = renderHook(({ key }) => useSubject(key), {
      initialProps: { key: 'page-1' },
    });
    await act(async () => result.current.regenerate.regenerateBlock('low'));
    rerender({ key: 'page-2' });
    expect(result.current.regenerate.results).toEqual({});
    await act(async () => result.current.regenerate.regenerateBlock('low'));
    rerender({ key: 'page-1' });
    expect(result.current.draft.value).toBe('新文');
    expect(result.current.regenerate.layout[0].confidence).toBe(0.9);
    expect(result.current.regenerate.results.low.original.markdown).toBe('原文');
  });

  it('两轮之间人工修改后不再调用后续模型轮次', async () => {
    let first!: (value: { markdown: string; confidence: number }) => void;
    let second!: (value: { markdown: string; confidence: number }) => void;
    const generate = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            first = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            second = resolve;
          }),
      )
      .mockResolvedValue({ markdown: '后续候选', confidence: 0.7 });
    mocks.regenerate.mockImplementation(() => generate());
    const { result } = renderHook(() => useSubject());
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.regenerate.regenerateBlock('low');
    });
    await act(async () => first({ markdown: '候选一', confidence: 0.6 }));
    expect(generate).toHaveBeenCalledTimes(2);
    act(() => result.current.draft.setValue('人工内容'));
    await act(async () => {
      second({ markdown: '候选二', confidence: 0.65 });
      await pending;
    });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.current.draft.value).toBe('人工内容');
  });

  it('主动停止重生成清除忙状态，迟到结果不应用', async () => {
    let resolve!: (value: ImageParseRegenerateResult) => void;
    const generate = vi.fn(
      () =>
        new Promise<ImageParseRegenerateResult>((done) => {
          resolve = done;
        }),
    );
    mocks.regenerate.mockImplementation(() => generate());
    const { result } = renderHook(() => useSubject());
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.regenerate.regenerateBlock('low');
    });
    expect(result.current.regenerate.busy).toBe(true);
    act(() => result.current.regenerate.stop());
    expect(result.current.regenerate.busy).toBe(false);
    await act(async () => {
      resolve({ markdown: '迟到候选', confidence: 0.9 });
      await pending;
    });
    expect(result.current.draft.value).toBe('原文');
    expect(result.current.regenerate.results).toEqual({});
  });

  it('完成一次后不可再次主动重生成', async () => {
    const generate = vi.fn().mockResolvedValue({ markdown: '第一次', confidence: 0.7 });
    mocks.regenerate.mockImplementation(() => generate());
    const { result } = renderHook(() => useSubject());
    await act(async () => result.current.regenerate.regenerateBlock('low'));
    expect(generate).toHaveBeenCalledTimes(5);
    await act(async () => result.current.regenerate.regenerateBlock('low'));
    expect(generate).toHaveBeenCalledTimes(5);
    expect(result.current.draft.value).toBe('第一次');
    expect(result.current.regenerate.results.low.original.markdown).toBe('原文');
    expect(result.current.regenerate.results.low.best.confidence).toBe(0.7);
  });

  it('批量不同长度的结果依次更新定位范围，不覆盖相邻块', async () => {
    mocks.regenerate.mockImplementation(async (_source, original: typeof block) => ({
      markdown: original.id === 'first' ? '甲甲甲' : '乙乙',
      confidence: 0.9,
    }));
    const { result } = renderHook(() => {
      const blocks = [
        { ...block, id: 'first', markdown: '甲', text: '甲' },
        { ...block, id: 'second', markdown: '乙', text: '乙' },
      ];
      const draft = useImageParseDraft(
        '甲\n\n乙',
        'batch',
        new Map([
          ['first', { start: 0, end: 1 }],
          ['second', { start: 3, end: 4 }],
        ]),
      );
      const regenerate = useImageParseRegeneration({
        resultKey: 'batch',
        model: 'minicpm-ocr-aio',
        secret: 'plain-secret',
        blocks,
        draft,
        source,
        loading: false,
        documentDataUrl: 'data:image/png;base64,AAA',
        mime: 'image/png',
        pageIndex: 0,
      });
      return { draft, regenerate };
    });
    await act(async () => result.current.regenerate.regenerateLowBlocks());
    expect(mocks.regenerate).toHaveBeenCalledTimes(2);
    expect(result.current.draft.value).toBe('甲甲甲\n\n乙乙');
    expect(result.current.draft.ranges.get('second')).toEqual({ start: 5, end: 7 });
  });

  it('批量第二块等待时停止，保留已完成块并拒绝迟到结果', async () => {
    let resolve!: (value: ImageParseRegenerateResult) => void;
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ markdown: '甲甲甲', confidence: 0.9 })
      .mockImplementationOnce(
        () =>
          new Promise<ImageParseRegenerateResult>((done) => {
            resolve = done;
          }),
      );
    mocks.regenerate.mockImplementation(() => generate());
    const { result } = renderHook(() => {
      const draft = useImageParseDraft(
        '甲\n\n乙',
        'batch-stop',
        new Map([
          ['first', { start: 0, end: 1 }],
          ['second', { start: 3, end: 4 }],
        ]),
      );
      const regenerate = useImageParseRegeneration({
        resultKey: 'batch-stop',
        model: 'minicpm-ocr-aio',
        secret: 'plain-secret',
        blocks: [
          { ...block, id: 'first', markdown: '甲', text: '甲' },
          { ...block, id: 'second', markdown: '乙', text: '乙' },
        ],
        draft,
        source,
        loading: false,
        documentDataUrl: 'data:image/png;base64,AAA',
        mime: 'image/png',
        pageIndex: 0,
      });
      return { draft, regenerate };
    });
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.regenerate.regenerateLowBlocks();
    });
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    expect(result.current.draft.value).toBe('甲甲甲\n\n乙');
    act(() => result.current.regenerate.stop());
    await act(async () => {
      resolve({ markdown: '迟到乙乙', confidence: 0.9 });
      await pending;
    });
    expect(result.current.regenerate.busy).toBe(false);
    expect(result.current.draft.value).toBe('甲甲甲\n\n乙');
    expect(result.current.regenerate.results.first.best.confidence).toBe(0.9);
    expect(result.current.regenerate.results.second).toBeUndefined();
  });
});
