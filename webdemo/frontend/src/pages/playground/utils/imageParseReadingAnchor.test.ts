import { describe, expect, it } from 'vitest';

import {
  captureImageParseReadingAnchor,
  resolveImageParseReadingTop,
} from './imageParseReadingAnchor';

interface Layout {
  clientHeight: number;
  scrollHeight: number;
  pageTop: number;
  headerTop: number;
  bodyTop: number;
}

function fixture(layout: Layout) {
  const viewport = document.createElement('div');
  const page = document.createElement('section');
  const header = document.createElement('p');
  const body = document.createElement('p');
  page.dataset.ocrResultPage = '2';
  header.dataset.ocrLinkedIds = JSON.stringify(['header']);
  body.dataset.ocrLinkedIds = JSON.stringify(['body']);
  page.append(header, body);
  viewport.append(page);

  Object.defineProperty(viewport, 'clientHeight', {
    configurable: true,
    get: () => layout.clientHeight,
  });
  Object.defineProperty(viewport, 'scrollHeight', {
    configurable: true,
    get: () => layout.scrollHeight,
  });
  viewport.getBoundingClientRect = () => new DOMRect(0, 0, 600, layout.clientHeight);
  page.getBoundingClientRect = () =>
    new DOMRect(0, layout.pageTop - viewport.scrollTop, 600, layout.scrollHeight);
  header.getBoundingClientRect = () =>
    new DOMRect(0, layout.headerTop - viewport.scrollTop, 600, 40);
  body.getBoundingClientRect = () =>
    new DOMRect(0, layout.bodyTop - viewport.scrollTop, 600, 120);

  return { viewport, page, header, body };
}

describe('结果栏阅读定位', () => {
  it('页眉移除后把同一正文块保持在视口原位置', () => {
    const layout: Layout = {
      clientHeight: 400,
      scrollHeight: 1200,
      pageTop: 0,
      headerTop: 80,
      bodyTop: 140,
    };
    const { viewport } = fixture(layout);
    viewport.scrollTop = 120;
    const anchor = captureImageParseReadingAnchor(viewport)!;
    expect(anchor.candidates[0]).toMatchObject({ ids: ['body'], page: 2, offset: 20 });

    layout.headerTop = -40;
    layout.bodyTop = 0;
    const top = resolveImageParseReadingTop(viewport, anchor);

    expect(top).toBe(0);
    viewport.scrollTop = top!;
    expect(layout.bodyTop - viewport.scrollTop).toBe(0);
  });

  it('顶部锚点随页眉一起被删除时，改用下一段可见正文', () => {
    const layout: Layout = {
      clientHeight: 400,
      scrollHeight: 1200,
      pageTop: 0,
      headerTop: 100,
      bodyTop: 180,
    };
    const { viewport, header } = fixture(layout);
    viewport.scrollTop = 100;
    const anchor = captureImageParseReadingAnchor(viewport)!;
    expect(anchor.candidates.map((candidate) => candidate.ids)).toEqual([
      ['header'],
      ['body'],
    ]);

    header.remove();
    layout.bodyTop = 80;
    const top = resolveImageParseReadingTop(viewport, anchor);

    expect(top).toBe(0);
    viewport.scrollTop = top!;
    expect(layout.bodyTop - viewport.scrollTop).toBe(80);
  });

  it('没有可定位块时退到页面位置，再退到整体阅读进度', () => {
    const layout: Layout = {
      clientHeight: 400,
      scrollHeight: 1200,
      pageTop: 40,
      headerTop: 40,
      bodyTop: 120,
    };
    const { viewport, page, header, body } = fixture(layout);
    header.removeAttribute('data-ocr-linked-ids');
    body.removeAttribute('data-ocr-linked-ids');
    viewport.scrollTop = 160;
    const anchor = captureImageParseReadingAnchor(viewport)!;
    expect(anchor.page).toBe(2);

    layout.pageTop = 0;
    expect(resolveImageParseReadingTop(viewport, anchor)).toBe(120);

    page.remove();
    expect(resolveImageParseReadingTop(viewport, anchor)).toBe(160);
  });
});
