import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useImageParseExampleMerge } from '../useImageParseExampleMerge';
import type { ImageParseSnapshot } from '../../utils/imageParseHistoryTypes';
import type { ImageParseLayoutBlock } from '../../utils/imageParseSample';

const HEADER =
  '<tr><th rowspan="2">名称</th><th colspan="2">数值</th></tr><tr><th>本期</th><th>上期</th></tr>';

function block(
  kind: ImageParseLayoutBlock['kind'],
  text: string,
  y: number,
  h: number,
  markdownStart: number,
): ImageParseLayoutBlock {
  return {
    id: `${kind}-${markdownStart}`,
    kind,
    x: 0,
    y,
    w: 1,
    h,
    text,
    markdown: text,
    markdownStart,
    markdownEnd: markdownStart + text.length,
    confidence: 0.9,
  };
}

/** Two-page example: the first page's table is at the end of the page, and the second page's table is at the start and repeats the header. */
function snapshot(page: number, table: string, atBottom: boolean): ImageParseSnapshot {
  const header = `页眉${page}`;
  const footer = `${page}`;
  const markdown = `${header}\n\n${table}\n\n${footer}`;
  const tableStart = markdown.indexOf(table);
  const footerStart = markdown.lastIndexOf(footer);
  return {
    attachment: {
      id: 'example:invoices',
      kind: 'image',
      name: `${page}.png`,
      mime: 'image/png',
      size: 1,
      dataUrl: 'data:image/png;base64,AQ==',
    },
    mode: 'scored',
    markdown,
    layout: [
      block('header', header, 0, 0.05, 0),
      block('table', table, atBottom ? 0.82 : 0.02, 0.16, tableStart),
      block('footer', footer, 0.98, 0.02, footerStart),
    ],
  };
}

const FIRST_TABLE = `<table>${HEADER}<tr><td>甲公司</td><td>10</td><td>9</td></tr></table>`;
const SECOND_TABLE = `<table>${HEADER}<tr><td>乙公司</td><td>20</td><td>19</td></tr></table>`;
const DETACHED_TABLE = `<table><tr><td>无关</td><td>1</td></tr></table>`;

describe('多页示例跨页表格合并', () => {
  it('不依赖 requestId，多页示例即视为可合并', () => {
    const onMerged = vi.fn();
    const { result } = renderHook(() =>
      useImageParseExampleMerge(
        [snapshot(1, FIRST_TABLE, true), snapshot(2, SECOND_TABLE, false)],
        onMerged,
      ),
    );
    expect(result.current.available).toBe(true);
  });

  it('单页示例不可合并，调用不产生通知', async () => {
    const onMerged = vi.fn();
    const { result } = renderHook(() =>
      useImageParseExampleMerge([snapshot(1, FIRST_TABLE, true)], onMerged),
    );
    expect(result.current.available).toBe(false);
    await act(async () => expect(await result.current.merge()).toBe(0));
    expect(onMerged).not.toHaveBeenCalled();
  });

  it('复用前端表格合并，返回续表数量并进入已合并状态', async () => {
    const onMerged = vi.fn();
    const pages = [snapshot(1, FIRST_TABLE, true), snapshot(2, SECOND_TABLE, false)];
    const { result } = renderHook(() => useImageParseExampleMerge(pages, onMerged));

    let count = 0;
    await act(async () => {
      count = await result.current.merge();
    });

    expect(count).toBe(1);
    expect(result.current).toMatchObject({ status: 'merged', pages: [0, 1] });
    const calls = onMerged.mock.calls;
    const merged = calls[calls.length - 1]?.[0] as Map<number, unknown>;
    expect([...merged.keys()]).toEqual([0, 1]);
  });

  it('表格不在页边界时保持原样', async () => {
    const onMerged = vi.fn();
    const { result } = renderHook(() =>
      useImageParseExampleMerge(
        [snapshot(1, DETACHED_TABLE, false), snapshot(2, SECOND_TABLE, false)],
        onMerged,
      ),
    );
    let count = 0;
    await act(async () => {
      count = await result.current.merge();
    });
    expect(count).toBe(0);
    expect(result.current.status).toBe('idle');
    const calls = onMerged.mock.calls;
    const merged = calls[calls.length - 1]?.[0] as Map<number, unknown>;
    expect([...merged.keys()]).toEqual([]);
  });

  it('取消合并通知调用方恢复原页', async () => {
    const onMerged = vi.fn();
    const { result } = renderHook(() =>
      useImageParseExampleMerge(
        [snapshot(1, FIRST_TABLE, true), snapshot(2, SECOND_TABLE, false)],
        onMerged,
      ),
    );
    await act(async () => {
      await result.current.merge();
    });
    act(() => result.current.unmerge());
    expect(onMerged).toHaveBeenLastCalledWith(new Map());
    expect(result.current.status).toBe('idle');
  });

  it('切换示例时清空上一组的合并状态', async () => {
    const { result, rerender } = renderHook(
      ({ pages }: { pages: ImageParseSnapshot[] }) => useImageParseExampleMerge(pages),
      {
        initialProps: {
          pages: [snapshot(1, FIRST_TABLE, true), snapshot(2, SECOND_TABLE, false)],
        },
      },
    );
    await act(async () => {
      await result.current.merge();
    });
    expect(result.current.status).toBe('merged');

    rerender({ pages: [snapshot(3, DETACHED_TABLE, false), snapshot(4, SECOND_TABLE, false)] });
    expect(result.current.status).toBe('idle');
    expect(result.current.pages).toEqual([]);
  });
});
