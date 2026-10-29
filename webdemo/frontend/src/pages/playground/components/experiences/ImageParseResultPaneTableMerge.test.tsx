import { render, screen } from '@testing-library/react';
import { ToastProvider } from '@map/ui';
import { describe, expect, it, vi } from 'vitest';

import { ImageParseResultPane } from './ImageParseResultPane';
import type { useImageParse } from '../../hooks/useImageParse';
import type { useImageParseTableMerge } from '../../hooks/useImageParseTableMerge';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const parse = {
  resultKey: 'single-image-table',
  mode: 'standard',
  markdown: '<table><tr><td>甲</td></tr></table>',
  layout: [
    {
      id: 'table-1',
      kind: 'table',
      x: 0,
      y: 0.1,
      w: 1,
      h: 0.2,
      text: '<table><tr><td>甲</td></tr></table>',
      markdown: '<table><tr><td>甲</td></tr></table>',
      confidence: 0.9,
    },
  ],
  crops: [],
  loading: false,
  finished: true,
  parse: vi.fn(),
} as unknown as ReturnType<typeof useImageParse>;

function tableMerge(status: 'idle' | 'merged'): ReturnType<typeof useImageParseTableMerge> {
  return {
    status,
    pages: [],
    enabled: true,
    available: true,
    merge: vi.fn().mockResolvedValue(1),
    unmerge: vi.fn(),
    scope: 'singleImage',
  } as ReturnType<typeof useImageParseTableMerge>;
}

describe('单图结果栏表格合并入口', () => {
  it('单图结果使用 imageTableMerge 渲染右上角操作', () => {
    render(
      <ToastProvider>
        <ImageParseResultPane
          parse={{ ...parse, imageTableMerge: tableMerge('idle') }}
          draft={{
            value: parse.markdown,
            dirty: false,
            ranges: new Map(),
            setValue: vi.fn(),
            reset: vi.fn(),
          }}
          onDownload={vi.fn()}
        />
      </ToastProvider>,
    );

    expect(screen.getByRole('button', { name: /imageParseMergeImageTables/ })).toBeEnabled();
  });

  it('合并后右上角切换为取消合并', () => {
    render(
      <ToastProvider>
        <ImageParseResultPane
          parse={{ ...parse, imageTableMerge: tableMerge('merged') }}
          draft={{
            value: parse.markdown,
            dirty: false,
            ranges: new Map(),
            setValue: vi.fn(),
            reset: vi.fn(),
          }}
          onDownload={vi.fn()}
        />
      </ToastProvider>,
    );

    expect(screen.getByRole('button', { name: /imageParseUnmergeTables/ })).toBeEnabled();
  });
});
