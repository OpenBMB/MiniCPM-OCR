import { act, render } from '@testing-library/react';
import { useCallback, useRef } from 'react';
import { describe, expect, it } from 'vitest';

import { useImageParseReadingPosition } from '../useImageParseReadingPosition';

function Harness({ preserveKey }: { preserveKey: boolean }) {
  const node = useRef<HTMLDivElement | null>(null);
  const scrollTo = useCallback((top: number) => {
    if (node.current) node.current.scrollTop = top;
  }, []);
  const reading = useImageParseReadingPosition({
    resultKey: 'result-1',
    preserveKey,
    scrollTo,
  });
  const { viewportRef } = reading;
  const setViewport = useCallback(
    (next: HTMLDivElement | null) => {
      node.current = next;
      viewportRef(next);
    },
    [viewportRef],
  );
  return (
    <div ref={setViewport} data-testid="viewport">
      <section data-ocr-result-page="2">
        <p data-ocr-linked-ids={JSON.stringify(['body'])} data-testid="body" />
      </section>
    </div>
  );
}

describe('useImageParseReadingPosition', () => {
  it('页眉页脚开关变化时在布局阶段恢复同一正文块', async () => {
    const { getByTestId, rerender } = render(<Harness preserveKey={false} />);
    const viewport = getByTestId('viewport');
    const body = getByTestId('body');
    const page = viewport.querySelector<HTMLElement>('[data-ocr-result-page="2"]')!;
    let bodyTop = 140;
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 400 });
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 1200 });
    viewport.getBoundingClientRect = () => new DOMRect(0, 0, 600, 400);
    page.getBoundingClientRect = () =>
      new DOMRect(0, -viewport.scrollTop, 600, viewport.scrollHeight);
    body.getBoundingClientRect = () => new DOMRect(0, bodyTop - viewport.scrollTop, 600, 120);

    await act(async () => {
      viewport.scrollTop = 120;
      viewport.dispatchEvent(new Event('scroll'));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    bodyTop = 0;
    rerender(<Harness preserveKey />);

    expect(viewport.scrollTop).toBe(0);
  });
});
