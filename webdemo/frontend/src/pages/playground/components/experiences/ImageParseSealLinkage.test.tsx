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

const sealText = '全国统一发票监制章 国家税务总局 山东省税务局';
const result = adaptImageParseV2({
  choices: [{ message: { content: `# 山东增值税电子专用发票\n\n${sealText}\n\n发票代码` } }],
  ocr: {
    mode: 'standard',
    image_width: 1000,
    image_height: 1000,
    blocks: [
      { label: 'doc_title', content: '山东增值税电子专用发票' },
      { label: 'seal', content: sealText },
      { label: 'text', content: '发票代码' },
    ].map((block, order) => ({
      ...block,
      order,
      status: 'ok',
      bbox: [10, order * 100, 500, order * 100 + 80],
    })),
  },
});
const ranges = imageParseBlockRanges(result.markdown, result.blocks);
const linkedRanges = [...ranges].map(([id, range]) => ({ id, range }));

/** 以真实适配结果连接原图框与图片/PDF 结果预览。 */
function SealLinkageWorkspace({
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
    mode: 'standard',
    resultKey: 'seal-linkage',
    resultKeyForPage: () => 'seal-linkage',
    markdown: result.markdown,
    loading: false,
    layout: result.blocks,
    pdf: pdf ? { page: 1, pages: 1, results: { 1: { result } }, setPage: vi.fn() } : undefined,
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

describe('OCR 印章文字点击定位', () => {
  it.each([false, true])('点击左侧印章只高亮并居中对应文字，PDF=%s', (pdf) => {
    const onFocus = vi.fn();
    const onSelectBlock = vi.fn();
    const { container } = render(
      <SealLinkageWorkspace pdf={pdf} onFocus={onFocus} onSelectBlock={onSelectBlock} />,
    );
    const viewport = container.querySelector<HTMLElement>('[data-ocr-result-scroll]')!;
    const target = container.querySelector<HTMLElement>('[data-ocr-block-id="ocr-1"]');
    const origin = container.querySelector<HTMLElement>('[data-origin-block-id="ocr-1"]')!;
    expect(target).not.toBeNull();
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1000 },
    });
    viewport.scrollTop = 100;
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 500, 400));
    vi.spyOn(target!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 600, 300, 100));

    fireEvent.click(origin);

    expect(origin).toHaveAttribute('aria-pressed', 'true');
    expect(target).toHaveAttribute('data-ocr-highlight', 'true');
    expect(target).toHaveTextContent(sealText);
    expect(container.querySelector('h1')).not.toHaveAttribute('data-ocr-highlight');
    expect(container.querySelectorAll('[data-ocr-highlight="true"]')).toHaveLength(1);
    expect(onFocus).toHaveBeenCalledExactlyOnceWith(550);

    fireEvent.click(target!);

    if (pdf) expect(onSelectBlock).toHaveBeenCalledExactlyOnceWith('ocr-1', 1);
    else expect(onSelectBlock).toHaveBeenCalledExactlyOnceWith('ocr-1');
  });
});
