import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlaygroundLayout } from './PlaygroundLayout';

function CitationPanelHarness({
  isMobile = false,
  onCloseRightPanel,
}: { isMobile?: boolean; onCloseRightPanel?: () => void } = {}) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [bodyClicks, setBodyClicks] = useState(0);

  return (
    <PlaygroundLayout
      sidebar={<aside>sidebar</aside>}
      topBar={<header>topbar</header>}
      isMobile={isMobile}
      mobileSidebarOpen={false}
      onCloseMobileSidebar={() => undefined}
      rightPanel={mounted ? <aside>引用来源 7</aside> : null}
      rightPanelOpen={open}
      onCloseRightPanel={() => {
        setOpen(false);
        onCloseRightPanel?.();
      }}
    >
      <button
        type="button"
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
      >
        打开引用
      </button>
      <button type="button" onClick={() => setOpen(false)}>
        关闭引用
      </button>
      <button type="button" onClick={() => setBodyClicks((n) => n + 1)}>
        正文按钮 {bodyClicks}
      </button>
    </PlaygroundLayout>
  );
}

describe('PlaygroundLayout', () => {
  const animationFrames: FrameRequestCallback[] = [];

  beforeEach(() => {
    animationFrames.length = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function flushAnimationFrame() {
    const callbacks = animationFrames.splice(0);
    callbacks.forEach((callback) => callback(0));
  }

  /** Two-frame entrance: after committing the collapsed state, the final state is entered across two frames; the panel counts as fully expanded only after those two frames. */
  function enterPanel() {
    act(flushAnimationFrame);
    act(flushAnimationFrame);
  }

  describe('桌面端（非模态并排）', () => {
    it('首次挂载先保持收起态，再平滑推开主区', async () => {
      const user = userEvent.setup();
      const { container } = render(<CitationPanelHarness />);

      expect(screen.queryByTestId('playground-right-panel')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: '打开引用' }));

      const panel = screen.getByTestId('playground-right-panel');
      // Occupy space in document flow (the main area gives up width) rather than leaving document flow and covering the body
      expect(panel).toHaveClass('relative', 'shrink-0');
      expect(panel).not.toHaveClass('fixed');
      expect(panel).toHaveAttribute('aria-hidden', 'true');
      expect(panel).toHaveAttribute('data-state', 'opening');
      expect(panel).toHaveClass('w-0');

      // The outer layer owns width and the inner layer owns translation; what slides in is the inner layer
      const surface = panel.firstElementChild as HTMLElement;
      expect(surface).toHaveClass('translate-x-6');

      act(flushAnimationFrame);
      expect(panel).toHaveAttribute('aria-hidden', 'true');

      act(flushAnimationFrame);
      expect(panel).toHaveAttribute('aria-hidden', 'false');
      expect(panel).toHaveAttribute('data-state', 'open');
      expect(panel).toHaveClass('w-[min(26rem,36vw)]');
      expect(panel).not.toHaveClass('w-0');
      expect(surface).toHaveClass('translate-x-0');
      expect(screen.getByText('引用来源 7')).toBeVisible();

      await user.click(screen.getByRole('button', { name: '关闭引用' }));

      expect(panel).toHaveAttribute('aria-hidden', 'true');
      expect(panel).toHaveAttribute('data-state', 'closed');
      expect(panel).toHaveClass('w-0');
      expect(surface).toHaveClass('translate-x-6');
      expect(container.querySelectorAll('[data-testid="playground-right-panel"]')).toHaveLength(1);
    });

    it('不渲染遮罩，面板打开时正文仍可点击', async () => {
      const user = userEvent.setup();
      const { container } = render(<CitationPanelHarness />);

      await user.click(screen.getByRole('button', { name: '打开引用' }));
      enterPanel();

      // A full-screen mask would turn the side-by-side panel into a modal in practice, dimming and locking the body — desktop must not have it
      expect(container.querySelector('.fixed.inset-0')).toBeNull();

      // Body buttons can still be clicked: userEvent errors on pointer-events: none, which guards interactivity for us
      await user.click(screen.getByRole('button', { name: /正文按钮/ }));
      expect(screen.getByRole('button', { name: '正文按钮 1' })).toBeInTheDocument();
    });

    it('面板挂载后裁剪主区溢出，避免让位瞬间横向溢出', async () => {
      const user = userEvent.setup();
      render(<CitationPanelHarness />);

      expect(screen.getByRole('main')).not.toHaveClass('overflow-hidden');

      await user.click(screen.getByRole('button', { name: '打开引用' }));
      expect(screen.getByRole('main')).toHaveClass('overflow-hidden');
    });
  });

  describe('移动端（覆盖式抽屉）', () => {
    it('覆盖在正文上且不改变主区宽度', async () => {
      const user = userEvent.setup();
      render(<CitationPanelHarness isMobile />);

      const mainClass = screen.getByRole('main').className;
      await user.click(screen.getByRole('button', { name: '打开引用' }));

      const panel = screen.getByTestId('playground-right-panel');
      expect(panel).toHaveClass('fixed', 'inset-y-0', 'right-0', 'z-40');
      expect(panel).toHaveClass('translate-x-full');

      enterPanel();
      expect(panel).toHaveAttribute('data-state', 'open');
      expect(panel).toHaveClass('translate-x-0');
      // A narrow screen has no side-by-side space; the panel leaves document flow, and the main-area width never changes
      expect(screen.getByRole('main').className).toBe(mainClass);
    });

    it('点击遮罩关闭覆盖式面板', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<CitationPanelHarness isMobile onCloseRightPanel={onClose} />);

      await user.click(screen.getByRole('button', { name: '打开引用' }));
      enterPanel();

      const panel = screen.getByTestId('playground-right-panel');
      // Query by testid, not by .fixed.inset-0.z-40: the mobile sidebar mask has the same shape and would be selected first
      await user.click(screen.getByTestId('playground-right-panel-overlay'));

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(panel).toHaveAttribute('aria-hidden', 'true');
    });
  });
});
