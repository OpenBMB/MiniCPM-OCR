import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useSplitPane } from '../../hooks/useSplitPane';
import { PaneDivider } from './ImageParsePanes';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function Workspace() {
  const split = useSplitPane();
  return (
    <div {...split.containerProps}>
      <PaneDivider split={split} />
    </div>
  );
}

describe('文档双栏拖拽分隔条', () => {
  it('保留原来的细分隔列，透明抓取区不占宽，交互时才显示短提示', () => {
    render(<Workspace />);
    const separator = screen.getByRole('separator', { name: 'imageParseSplitter' });
    expect(separator).toHaveClass(
      'w-px',
      '-mx-px',
      'touch-none',
      'bg-transparent',
      'before:top-1/2',
      'before:left-0',
      'before:h-12',
      'before:w-px',
      'before:-translate-y-1/2',
      'before:rounded-full',
      'before:opacity-0',
      'before:bg-primary/30',
      'hover:before:opacity-100',
      'focus-visible:before:bg-primary',
      'focus-visible:before:opacity-100',
      'data-[dragging=true]:before:bg-primary/60',
      'data-[dragging=true]:before:opacity-100',
      'motion-reduce:before:transition-none',
    );
    expect(separator).not.toHaveClass('w-8', 'bg-primary/[0.025]');
    expect(separator).toHaveClass(
      'hidden',
      'lg:block',
      'after:-left-3',
      'after:-right-3',
      '[@media(pointer:coarse)]:after:-left-[22px]',
      '[@media(pointer:coarse)]:after:-right-[22px]',
    );
    expect(separator).toHaveAttribute('aria-orientation', 'vertical');
    expect(separator).toHaveAttribute('tabindex', '0');
    expect(separator).toHaveAttribute('aria-valuenow', '50');
  });

  it('拖动按容器宽度调整比例，限制比例并在释放后停止调整', () => {
    render(<Workspace />);
    const separator = screen.getByRole('separator');
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.defineProperties(separator, {
      setPointerCapture: { value: setPointerCapture },
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: releasePointerCapture },
    });
    vi.spyOn(separator.parentElement!, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 1000,
    } as DOMRect);
    vi.spyOn(separator, 'getBoundingClientRect').mockReturnValue({
      left: 499,
      width: 1,
    } as DOMRect);
    fireEvent(separator, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 500 }));
    expect(separator).toHaveAttribute('data-dragging', 'true');
    expect(setPointerCapture).toHaveBeenCalledOnce();
    fireEvent(separator, new MouseEvent('pointermove', { bubbles: true, clientX: 600 }));
    expect(separator).toHaveAttribute('aria-valuenow', '60');
    fireEvent(separator, new MouseEvent('pointermove', { bubbles: true, clientX: 900 }));
    expect(separator).toHaveAttribute('aria-valuenow', '76');
    fireEvent(separator, new MouseEvent('pointerup', { bubbles: true }));
    expect(separator).toHaveAttribute('data-dragging', 'false');
    expect(releasePointerCapture).toHaveBeenCalledOnce();
    fireEvent(separator, new MouseEvent('pointermove', { bubbles: true, clientX: 400 }));
    expect(separator).toHaveAttribute('aria-valuenow', '76');
  });

  it('从透明抓取区边缘按下不跳动，丢失指针捕获后清除拖动状态', () => {
    render(<Workspace />);
    const separator = screen.getByRole('separator');
    Object.defineProperties(separator, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: () => false },
    });
    vi.spyOn(separator.parentElement!, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      width: 1000,
    } as DOMRect);
    vi.spyOn(separator, 'getBoundingClientRect').mockReturnValue({
      left: 599,
      width: 1,
    } as DOMRect);
    fireEvent(separator, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 590 }));
    fireEvent(separator, new MouseEvent('pointermove', { bubbles: true, clientX: 590 }));
    expect(separator).toHaveAttribute('aria-valuenow', '50');
    fireEvent(separator, new MouseEvent('pointermove', { bubbles: true, clientX: 690 }));
    expect(separator).toHaveAttribute('aria-valuenow', '60');
    fireEvent(separator, new MouseEvent('lostpointercapture', { bubbles: true }));
    expect(separator).toHaveAttribute('data-dragging', 'false');
    fireEvent(separator, new MouseEvent('pointermove', { bubbles: true, clientX: 800 }));
    expect(separator).toHaveAttribute('aria-valuenow', '60');
  });

  it('只接受发起拖动的指针，取消后释放捕获并恢复默认状态', () => {
    render(<Workspace />);
    const separator = screen.getByRole('separator');
    const releasePointerCapture = vi.fn();
    Object.defineProperties(separator, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: releasePointerCapture },
    });
    vi.spyOn(separator.parentElement!, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 1000,
    } as DOMRect);
    vi.spyOn(separator, 'getBoundingClientRect').mockReturnValue({
      left: 499,
      width: 1,
    } as DOMRect);
    const pointer = (type: string, pointerId: number, clientX = 500, button = 0) => {
      const event = new MouseEvent(type, { bubbles: true, button, clientX });
      Object.defineProperty(event, 'pointerId', { value: pointerId });
      fireEvent(separator, event);
    };
    pointer('pointerdown', 1, 500, 2);
    expect(separator).toHaveAttribute('data-dragging', 'false');
    pointer('pointerdown', 1);
    pointer('pointerdown', 2);
    pointer('pointermove', 2, 900);
    pointer('pointerup', 2);
    expect(separator).toHaveAttribute('aria-valuenow', '50');
    expect(separator).toHaveAttribute('data-dragging', 'true');
    pointer('pointermove', 1, 600);
    expect(separator).toHaveAttribute('aria-valuenow', '60');
    pointer('pointercancel', 1);
    expect(separator).toHaveAttribute('data-dragging', 'false');
    expect(releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it('仍支持键盘调宽、上下限和双击恢复均分', () => {
    render(<Workspace />);
    const separator = screen.getByRole('separator');
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator).toHaveAttribute('aria-valuenow', '52');
    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(separator).toHaveAttribute('aria-valuenow', '50');
    fireEvent.keyDown(separator, { key: 'Home' });
    expect(separator).toHaveAttribute('aria-valuenow', '24');
    fireEvent.keyDown(separator, { key: 'End' });
    expect(separator).toHaveAttribute('aria-valuenow', '76');
    fireEvent.doubleClick(separator);
    expect(separator).toHaveAttribute('aria-valuenow', '50');
  });

  it('键盘调宽过渡尚未结束时，从当前显示比例开始拖动而不跳到目标比例', () => {
    render(<Workspace />);
    const separator = screen.getByRole('separator');
    Object.defineProperties(separator, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: () => false },
    });
    vi.spyOn(separator.parentElement!, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 1000,
    } as DOMRect);
    vi.spyOn(separator, 'getBoundingClientRect').mockReturnValue({
      left: 509,
      width: 1,
    } as DOMRect);
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator).toHaveAttribute('aria-valuenow', '52');
    fireEvent(separator, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 500 }));
    expect(separator).toHaveAttribute('aria-valuenow', '51');
    fireEvent(separator, new MouseEvent('pointermove', { bubbles: true, clientX: 500 }));
    expect(separator).toHaveAttribute('aria-valuenow', '51');
    fireEvent(separator, new MouseEvent('pointermove', { bubbles: true, clientX: 600 }));
    expect(separator).toHaveAttribute('aria-valuenow', '61');
  });
});
