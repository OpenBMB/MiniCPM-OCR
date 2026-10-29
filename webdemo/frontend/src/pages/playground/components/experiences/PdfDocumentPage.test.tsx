import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PdfDocumentPage } from './PdfDocumentPage';
import type { ImageParseLayoutBlock } from '../../utils/imageParseSample';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const block: ImageParseLayoutBlock = {
  id: 'block-1',
  order: 0,
  kind: 'text',
  x: 0.1,
  y: 0.2,
  w: 0.3,
  h: 0.1,
  confidence: 0.95,
  text: '正文',
  markdown: '正文',
  markdownStart: 0,
  markdownEnd: 2,
  status: 'ok',
};

function renderPage(rotation: number, serverAngle: number) {
  return render(
    <PdfDocumentPage
      pageNumber={1}
      width={600}
      height={800}
      label="page 1"
      active
      renderCanvas
      ready
      rotation={rotation}
      serverAngle={serverAngle}
      blocks={[block]}
      showBlocks
      onSelectBlock={vi.fn()}
      setPageNode={vi.fn()}
      setPageCanvas={vi.fn()}
    />,
  );
}

describe('PdfDocumentPage 服务端摆正', () => {
  it('按本页角度交换占位尺寸，只旋转底图，识别框留在摆正坐标系', () => {
    const { container } = renderPage(0, 90);
    const page = container.querySelector('[data-pdf-page="1"]') as HTMLElement;
    expect(page.style.getPropertyValue('--pdf-page-width')).toBe('800px');
    expect(page.style.getPropertyValue('--pdf-page-height')).toBe('600px');
    expect(page.style.overflow).toBe('hidden');
    const base = page.firstElementChild as HTMLElement;
    expect(base.style.transform).toContain('rotate(-90deg)');
    const frame = container.querySelector('[data-origin-block-id]')!.parentElement as HTMLElement;
    expect(frame.style.left).toBe('70%');
    expect(frame.style.top).toBe('10%');
    expect(frame.style.width).toBe('10%');
    expect(frame.style.height).toBe('30%');
  });

  it('用户再旋转整份文档时不再套用服务端旋转，避免叠加', () => {
    const { container } = renderPage(90, 90);
    const page = container.querySelector('[data-pdf-page="1"]') as HTMLElement;
    expect(page.style.getPropertyValue('--pdf-page-width')).toBe('600px');
    const base = page.firstElementChild as HTMLElement;
    expect(base.tagName).toBe('CANVAS');
    expect(base.style.transform).toBe('');
  });

  it('没有服务端角度时保持原方向与原有框坐标', () => {
    const { container } = renderPage(0, 0);
    const page = container.querySelector('[data-pdf-page="1"]') as HTMLElement;
    expect(page.style.getPropertyValue('--pdf-page-width')).toBe('600px');
    const frame = container.querySelector('[data-origin-block-id]')!.parentElement as HTMLElement;
    expect(frame.style.left).toBe('10%');
    expect(frame.style.top).toBe('20%');
  });
});
