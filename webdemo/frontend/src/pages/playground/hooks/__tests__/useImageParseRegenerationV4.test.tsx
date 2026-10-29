import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useImageParseRegeneration } from '../useImageParseRegeneration';
import { useImageParseDraft } from '../useImageParseDraft';

const mocks = vi.hoisted(() => ({ regenerate: vi.fn() }));
vi.mock('@/api/map/imageParseV2', () => ({ regenerateImageParseV4: mocks.regenerate }));
const source = {
  requestId: 'a'.repeat(32),
  model: 'minicpm-ocr-tts' as const,
  pageIndex: 3,
  createdAt: Math.floor(Date.now() / 1000),
  expiresAt: Math.floor(Date.now() / 1000) + 86_400,
  token: 'signed.source',
};
const block = {
  id: 'ocr-14',
  order: 14,
  status: 'ok',
  kind: 'text' as const,
  x: 0,
  y: 0,
  w: 1,
  h: 0.1,
  text: '原文',
  markdown: '原文',
  confidence: 0.4,
};
function useSubject(expired = false) {
  const draft = useImageParseDraft('原文', 'v4', new Map([['ocr-14', { start: 0, end: 2 }]]));
  const regeneration = useImageParseRegeneration({
    resultKey: 'v4',
    blocks: [block],
    draft,
    loading: false,
    source: expired ? { ...source, expiresAt: source.createdAt - 1 } : source,
    model: 'selected-ocr-model',
    secret: 'plain-secret',
    documentDataUrl: 'unused-pdf',
    mime: 'application/pdf',
    pageIndex: 3,
  });
  return { draft, regeneration };
}

describe('真实块重算接入预留入口', () => {
  beforeEach(() => {
    mocks.regenerate.mockReset();
  });

  it('有整页来源时无需安装 SDK，服务端完整优化只调用一次', async () => {
    mocks.regenerate.mockResolvedValue({ markdown: '新文', confidence: 0.7, roundsUsed: 5 });
    const { result } = renderHook(() => useSubject());
    expect(result.current.regeneration.available).toBe(true);
    await act(async () => result.current.regeneration.regenerateBlock('ocr-14'));
    expect(mocks.regenerate).toHaveBeenCalledExactlyOnceWith(
      source,
      block,
      expect.any(AbortSignal),
      'selected-ocr-model',
      'plain-secret',
    );
    expect(result.current.draft.value).toBe('新文');
    expect(result.current.regeneration.results['ocr-14'].rounds).toBe(5);
  });

  it('历史来源的兼容过期时间不阻止重算', async () => {
    mocks.regenerate.mockResolvedValueOnce({ markdown: '新文', confidence: 0.7, roundsUsed: 5 });
    const { result } = renderHook(() => useSubject(true));
    expect(result.current.regeneration.available).toBe(true);
    expect(result.current.regeneration.unavailableReason).toBeUndefined();
    await act(async () => result.current.regeneration.regenerateBlock('ocr-14'));
    expect(mocks.regenerate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ expiresAt: source.createdAt - 1 }),
      block,
      expect.any(AbortSignal),
      'selected-ocr-model',
      'plain-secret',
    );
    expect(result.current.draft.value).toBe('新文');
  });
});
