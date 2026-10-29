import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageParseSdkResult } from '@/api/map/imageParseSdk';

import type { Attachment } from '../types';
import type { ImageParseLayoutBlock } from '../utils/imageParseSample';
import { usePdfImageParse } from './usePdfImageParse';

const mocks = vi.hoisted(() => ({
  parsePages: vi.fn(),
  merge: vi.fn(),
  mergeAvailable: vi.fn(),
  mergeRemote: vi.fn(),
}));
vi.mock('../utils/pdfImageParse', () => ({ parsePdfPages: mocks.parsePages }));
vi.mock('../utils/imageParseTableMerge', () => ({ mergeImageParseTables: mocks.merge }));
vi.mock('@/api/map/imageParseV2', () => ({
  crossPageMergeAvailable: mocks.mergeAvailable,
  mergeImageParseCrossPage: mocks.mergeRemote,
}));
vi.mock('./usePdfImageParseCrops', () => ({ usePdfImageParseCrops: () => undefined }));
vi.mock('../utils/imageParseFeatureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/imageParseFeatureFlags')>()),
  IMAGE_PARSE_CROSS_PAGE_MERGE_ENABLED: true,
}));

const pdf: Attachment = {
  id: 'doc',
  kind: 'file',
  name: 'a.pdf',
  mime: 'application/pdf',
  size: 1,
  dataUrl: 'data:application/pdf;base64,AA==',
};

const requestId = (page: number) => String(page).padStart(32, '0');

function block(
  kind: ImageParseLayoutBlock['kind'],
  text: string,
  start: number,
): ImageParseLayoutBlock {
  return {
    id: `${kind}-${start}`,
    kind,
    x: 0,
    y: 0,
    w: 1,
    h: 0.1,
    text,
    markdown: text,
    markdownStart: start,
    markdownEnd: start + text.length,
    confidence: null,
  };
}

/** Each page: header + body, with a page number in the body, so filtering and merging are easy to assert. */
function page(index: number, body = `正文${index}`): ImageParseSdkResult {
  const header = '页眉';
  return {
    markdown: `${header}\n\n${body}`,
    blocks: [block('header', header, 0), block('text', body, header.length + 2)],
    requestId: requestId(index),
  };
}

function render(hideHeaderFooter = false) {
  return renderHook(
    ({ hide }) => usePdfImageParse(pdf, 'scored', 'm', 's', true, undefined, hide),
    { initialProps: { hide: hideHeaderFooter } },
  );
}

beforeEach(() => {
  mocks.merge.mockReset().mockReturnValue(new Map());
  mocks.mergeAvailable.mockReset().mockResolvedValue(false);
  mocks.mergeRemote.mockReset();
  mocks.parsePages.mockReset().mockImplementation(async (...args: unknown[]) => {
    const onOpen = args[5] as (pages: number) => void;
    const onPage = args[6] as (
      index: number,
      value: { result: ImageParseSdkResult; crops: string[] },
    ) => void;
    onOpen(3);
    for (const index of [1, 2, 3])
      onPage(index, { result: page(index - 1), crops: [`crop${index}`] });
  });
});

describe('usePdfImageParse 跨页表格合并', () => {
  it('识别完成前不可合并，完成后自动检查', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.tableMerge.available).toBe(true));
    expect(result.current.tableMerge.status).toBe('idle');
  });

  it('识别完成后自动合并，覆盖有变化的页，裁图沿用；撤销后恢复原页', async () => {
    const mergedPage: ImageParseSdkResult = {
      markdown: '页眉\n\n',
      blocks: [{ ...block('table', '', 4), mergedIntoPreviousPage: true, ttsInvalid: true }],
      requestId: requestId(1),
    };
    mocks.merge.mockReturnValue(new Map([[1, mergedPage]]));
    const { result } = render();
    await waitFor(() => expect(result.current.tableMerge.status).toBe('merged'));
    const untouched = result.current.resultIdentityForPage(1);
    expect(result.current.tableMerge.pages).toEqual([2]);
    expect(result.current.results[2]!.result).toBe(mergedPage);
    expect(result.current.results[2]!.crops).toEqual(['crop2']);
    // Pages changed by a merge get a new identity; draft edits are kept separately
    expect(result.current.resultIdentityForPage(2)).toContain(':merged');
    expect(result.current.resultIdentityForPage(1)).toBe(untouched);

    act(() => result.current.tableMerge.unmerge());
    expect(result.current.tableMerge.status).toBe('idle');
    expect(result.current.results[2]!.result!.markdown).toBe('页眉\n\n正文1');
    expect(result.current.resultIdentityForPage(2)).not.toContain(':merged');
    // After the user undoes on purpose, the effect must not merge automatically again.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.tableMerge.status).toBe('idle');
  });

  it('跨页表格合并使用本地结果，并按 0 起始页码映射回工作台', async () => {
    const mergedPage: ImageParseSdkResult = {
      markdown: '页眉\n\n',
      blocks: [{ ...block('table', '', 4), mergedIntoPreviousPage: true, ttsInvalid: true }],
      requestId: requestId(1),
    };
    mocks.merge.mockReturnValue(new Map([[1, mergedPage]]));
    const { result } = render();
    await waitFor(() => expect(result.current.tableMerge.status).toBe('merged'));
    expect(mocks.merge).toHaveBeenCalledOnce();
    expect(mocks.mergeRemote).not.toHaveBeenCalled();
    expect(result.current.tableMerge.pages).toEqual([2]);
    expect(result.current.results[2]!.result).toBe(mergedPage);
  });

  it('远端合并不参与结果，已识别页面保持本地合并状态', async () => {
    const mergedPage: ImageParseSdkResult = {
      markdown: '页眉\n\n',
      blocks: [{ ...block('table', '', 4), mergedIntoPreviousPage: true, ttsInvalid: true }],
      requestId: requestId(1),
    };
    mocks.merge.mockReturnValue(new Map([[1, mergedPage]]));
    const { result } = render();
    await waitFor(() => expect(result.current.tableMerge.status).toBe('merged'));
    expect(mocks.mergeAvailable).not.toHaveBeenCalled();
    expect(mocks.mergeRemote).not.toHaveBeenCalled();
    expect(mocks.merge).toHaveBeenCalledOnce();
    expect(result.current.results[2]!.result).toBe(mergedPage);
  });

  it('自动检查没有发现可合并表格时保持 idle，手动重试仍可执行', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.tableMerge.available).toBe(true));
    await waitFor(() => expect(mocks.merge).toHaveBeenCalledOnce());
    expect(result.current.tableMerge.status).toBe('idle');
    const mergedPage: ImageParseSdkResult = {
      markdown: '页眉\n\n',
      blocks: [{ ...block('table', '', 4), mergedIntoPreviousPage: true, ttsInvalid: true }],
      requestId: requestId(1),
    };
    mocks.merge.mockReturnValue(new Map([[1, mergedPage]]));
    await act(async () => {
      expect(await result.current.tableMerge.merge()).toBe(1);
    });
    expect(result.current.tableMerge.status).toBe('merged');
  });
});

describe('usePdfImageParse 页眉页脚屏蔽', () => {
  it('打开后各页结果去掉页眉，关闭后恢复；切换不重新识别', async () => {
    const { result, rerender } = render(false);
    await waitFor(() => expect(result.current.results[1]?.result).toBeDefined());
    expect(result.current.results[1]!.result!.markdown).toBe('页眉\n\n正文0');

    rerender({ hide: true });
    expect(result.current.results[1]!.result!.markdown).toBe('正文0');
    expect(result.current.current!.result!.blocks.map((b) => b.kind)).toEqual(['text']);

    rerender({ hide: false });
    expect(result.current.results[1]!.result!.markdown).toBe('页眉\n\n正文0');
    expect(mocks.parsePages).toHaveBeenCalledOnce();
  });
});
