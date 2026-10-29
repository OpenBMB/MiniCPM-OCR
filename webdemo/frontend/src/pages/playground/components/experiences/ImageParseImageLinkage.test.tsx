import { useState } from 'react';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { adaptImageParseV2 } from '@/api/map/imageParseV2';

import type { useImageParse } from '../../hooks/useImageParse';
import { imageParseBlockRanges } from '../../utils/imageParseBlocks';
import { ImageParseBlocksOverlay } from './ImageParseBlocksOverlay';
import { ImageParseResultPane } from './ImageParseResultPane';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/api/map/request', () => ({ mapRequest: vi.fn() }));

const result = adaptImageParseV2({
  choices: [{ message: { content: '![image]()\n\n（2）所求的功为\n\n图 3' } }],
  minicpm_ocr: {
    request_id: 'image-linkage-test',
    mode: 'stp',
    image_width: 1000,
    image_height: 1000,
    blocks: [
      {
        order: 0,
        content: '（2）所求的功为',
        label: 'text',
        status: 'ok',
        score: 0.99,
        bbox: [10, 100, 300, 120],
      },
      {
        order: 1,
        content: '',
        label: 'image',
        status: 'skipped_no_vlm',
        bbox: [600, 100, 900, 400],
      },
    ],
  },
});
const ranges = imageParseBlockRanges(result.markdown, result.blocks);
const linkedRanges = [...ranges].map(([id, range]) => ({ id, range }));
const crops = ['data:image/png;base64,AA=='];

/** Reuse the original-image selection and result-location path, covering the real image mapping for images and continuous PDFs. */
function ImageLinkageWorkspace({
  pdf,
  onFocus,
  onSelectBlock,
}: {
  pdf: boolean;
  onFocus: (top: number) => void;
  onSelectBlock: (id: string, page?: number) => void;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const [focusRequest, setFocusRequest] = useState(0);
  const parse = {
    resultKey: 'image-linkage',
    resultKeyForPage: () => 'image-linkage',
    markdown: result.markdown,
    loading: false,
    layout: result.blocks,
    crops,
    pdf: pdf
      ? { page: 1, pages: 1, results: { 1: { result, crops } }, setPage: vi.fn() }
      : undefined,
  } as unknown as ReturnType<typeof useImageParse>;
  return (
    <>
      <ImageParseBlocksOverlay
        blocks={result.blocks}
        selectedBlockId={selectedId}
        onSelect={(id) => {
          setSelectedId(id);
          setFocusRequest((previous) => previous + 1);
        }}
      />
      <ImageParseResultPane
        parse={parse}
        draft={{ value: result.markdown, dirty: false, ranges, setValue: vi.fn(), reset: vi.fn() }}
        linkedRanges={linkedRanges}
        selectedBlockId={selectedId}
        focusRequest={focusRequest}
        onPreviewFocus={onFocus}
        onSelectBlock={onSelectBlock}
      />
    </>
  );
}

describe('OCR 图片块点击定位', () => {
  it.each([false, true])('图片顺序错位时点击原图仍高亮并居中对应裁图，PDF=%s', (pdf) => {
    const onFocus = vi.fn();
    const onSelectBlock = vi.fn();
    const { container } = render(
      <ImageLinkageWorkspace pdf={pdf} onFocus={onFocus} onSelectBlock={onSelectBlock} />,
    );
    const viewport = container.querySelector<HTMLElement>('[data-ocr-result-scroll]')!;
    const target = container.querySelector<HTMLElement>('[data-ocr-block-id="ocr-1"]')!;
    const origin = container.querySelector<HTMLElement>('[data-origin-block-id="ocr-1"]')!;
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1000 },
    });
    viewport.scrollTop = 100;
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 500, 400));
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 600, 300, 100));

    fireEvent.click(origin);

    expect(origin).toHaveAttribute('aria-pressed', 'true');
    expect(target).toHaveAttribute('data-ocr-highlight', 'true');
    expect(target.querySelector('img')).toHaveAttribute('src', crops[0]);
    expect(container.querySelectorAll('[data-ocr-highlight="true"]')).toHaveLength(1);
    expect(onFocus).toHaveBeenCalledExactlyOnceWith(550);

    fireEvent.click(target.querySelector('img')!);

    if (pdf) expect(onSelectBlock).toHaveBeenCalledExactlyOnceWith('ocr-1', 1);
    else expect(onSelectBlock).toHaveBeenCalledExactlyOnceWith('ocr-1');
  });
});
