import { act, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { ImageParseSdkResult } from '@/api/map/imageParseSdk';
import type { ImageParseLayoutBlock } from '../../utils/imageParseSample';
import { useImageParseTableMerge } from '../useImageParseTableMerge';

const FIRST = '<table><tr><th>名称</th><th>数量</th></tr><tr><td>甲</td><td>1</td></tr></table>';
const SECOND = '<table><tr><td>乙</td><td>2</td></tr></table>';

function block(table: string, y: number, markdownStart: number): ImageParseLayoutBlock {
  return {
    id: `table-${markdownStart}`,
    kind: 'table',
    order: markdownStart === 0 ? 0 : 1,
    x: 0,
    y,
    w: 1,
    h: 0.2,
    text: table,
    markdown: table,
    markdownStart,
    markdownEnd: markdownStart + table.length,
    confidence: 0.9,
  };
}

function result(): ImageParseSdkResult {
  const markdown = `${FIRST}\n\n${SECOND}`;
  return {
    markdown,
    requestId: 'single-image',
    blocks: [block(FIRST, 0.1, 0), block(SECOND, 0.31, markdown.indexOf(SECOND))],
  };
}

describe('useImageParseTableMerge', () => {
  it('识别完成后自动合并单图相邻表格，并支持撤销恢复原结果', async () => {
    const initial = result();
    const { result: current } = renderHook(() => {
      const [markdown, setMarkdown] = useState(initial.markdown);
      const [layout, setLayout] = useState<readonly ImageParseLayoutBlock[]>(initial.blocks);
      const tableMerge = useImageParseTableMerge({
        enabled: true,
        markdown,
        layout,
        setMarkdown,
        setLayout,
        finished: true,
        loading: false,
        resultRevision: 1,
        attachmentId: 'image-a',
      });
      return { markdown, layout, tableMerge };
    });

    await waitFor(() => expect(current.current.tableMerge.status).toBe('merged'));
    expect(current.current.markdown.match(/<table/g)).toHaveLength(1);
    expect(current.current.layout).toHaveLength(1);
    expect(current.current.layout[0]).toMatchObject({ ttsInvalid: true });

    act(() => current.current.tableMerge.unmerge());

    expect(current.current.tableMerge.status).toBe('idle');
    expect(current.current.markdown).toBe(initial.markdown);
    expect(current.current.layout).toEqual(initial.blocks);
  });
});
