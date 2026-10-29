import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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

const markdown = '## 1. Computational Tool\n\n01A\n\n## 2. Computational Tool\n\n01A';
const result = adaptImageParseV2({
  choices: [{ message: { content: markdown } }],
  minicpm_ocr: {
    request_id: 'pdf-hover-test',
    mode: 'stp',
    image_width: 1000,
    image_height: 1000,
    blocks: [
      ['1. Computational Tool', 'paragraph_title'],
      ['01A', 'text'],
      ['2. Computational Tool', 'paragraph_title'],
      ['01A', 'text'],
    ].map(([content, label], order) => ({
      content,
      label,
      order,
      status: 'ok',
      bbox: [10, 100 + order * 30, 300, 120 + order * 30],
      score: 0.99,
    })),
  },
});
const ranges = imageParseBlockRanges(result.markdown, result.blocks);
const linkedRanges = [...ranges].map(([id, range]) => ({ id, range }));

/** Reuse the workspace hover-state path, covering the two-way mapping from a real service response to original-image boxes. */
function PdfHoverWorkspace() {
  const [hoveredId, setHoveredId] = useState<string>();
  const parse = {
    resultKey: 'pdf-hover',
    markdown: result.markdown,
    loading: false,
    layout: result.blocks,
  } as unknown as ReturnType<typeof useImageParse>;
  return (
    <>
      <ImageParseBlocksOverlay
        blocks={result.blocks}
        hoveredBlockId={hoveredId}
        onHoverBlock={setHoveredId}
        onSelect={vi.fn()}
      />
      <ImageParseResultPane
        parse={parse}
        draft={{ value: result.markdown, dirty: false, ranges, setValue: vi.fn(), reset: vi.fn() }}
        linkedRanges={linkedRanges}
        hoveredBlockId={hoveredId}
        onHoverBlock={setHoveredId}
      />
    </>
  );
}

describe('PDF 结果悬停联动', () => {
  it('悬停第二个编号标题只高亮左侧对应框，离开后清除', () => {
    const { container } = render(<PdfHoverWorkspace />);
    fireEvent.mouseOver(screen.getByRole('button', { name: '2. Computational Tool' }));
    expect(container.querySelectorAll('[data-origin-highlight="true"]')).toHaveLength(1);
    expect(container.querySelector('[data-origin-block-id="ocr-2"]')).toHaveAttribute(
      'data-origin-highlight',
      'true',
    );
    expect(container.querySelector('[data-origin-block-id="ocr-0"]')).not.toHaveAttribute(
      'data-origin-highlight',
    );
    fireEvent.mouseLeave(container.querySelector('article')!);
    expect(container.querySelector('[data-origin-highlight="true"]')).toBeNull();
  });

  it('重复的 01A 按出现次序映射，不指向第一个编号', () => {
    const { container } = render(<PdfHoverWorkspace />);
    fireEvent.mouseOver(screen.getAllByText('01A')[1]);
    expect(container.querySelectorAll('[data-origin-highlight="true"]')).toHaveLength(1);
    expect(container.querySelector('[data-origin-block-id="ocr-3"]')).toHaveAttribute(
      'data-origin-highlight',
      'true',
    );
    expect(container.querySelector('[data-origin-block-id="ocr-1"]')).not.toHaveAttribute(
      'data-origin-highlight',
    );
  });
});
