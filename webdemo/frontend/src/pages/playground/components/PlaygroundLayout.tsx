/**
 * Full-screen shell of the experience center.
 *
 * Purpose: a full-screen layout of the left sidebar + the right main area (top bar + content + bottom disclaimer). On desktop (≥lg) the sidebar stays side by side; on mobile the sidebar becomes a drawer (fixed slide-out + mask) and the main area takes the full width. A pure structure component, with no business logic.
 *
 * Filing-record note: the experience center uses an independent full-screen shell and does not put the filing record at the bottom (the filing record already stays on the login page and on every business page under AdminLayout). This is changed to "AI-generated-content disclaimer + agreement entry."
 */

import { useEffect, useState } from 'react';

import { cn } from '@map/ui';

import { PlaygroundFooter } from './PlaygroundFooter';

interface PlaygroundLayoutProps {
  sidebar: React.ReactNode;
  topBar: React.ReactNode;
  children: React.ReactNode;
  /** Whether this is mobile (<lg): the sidebar becomes a drawer, and the right workspace becomes an overlay */
  isMobile: boolean;
  /** Whether the mobile drawer is open */
  mobileSidebarOpen: boolean;
  /** Close the mobile drawer (click the mask) */
  onCloseMobileSidebar: () => void;
  /** Non-modal workspace on the right of the language-model main area. */
  rightPanel?: React.ReactNode;
  /** Whether the right workspace is expanded. */
  rightPanelOpen?: boolean;
  /** Close the right workspace; desktop non-modal mode does not need this, and it fires only when the mobile mask is clicked. */
  onCloseRightPanel?: () => void;
  /** When a workspace such as image parse brings its own top bar, do not stack the experience-center disclaimer bar */
  hideFooter?: boolean;
}

/**
 * Full-screen shell. Use h-dvh with a 100vh fallback to fit the mobile address bar.
 */
export function PlaygroundLayout({
  sidebar,
  topBar,
  children,
  isMobile,
  mobileSidebarOpen,
  onCloseMobileSidebar,
  rightPanel,
  rightPanelOpen = false,
  onCloseRightPanel,
  hideFooter = false,
}: PlaygroundLayoutProps) {
  return (
    <div className="flex h-screen h-[100dvh] w-full overflow-hidden bg-muted/30">
      {isMobile ? (
        <>
          {/* Mask */}
          <div
            className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 ${
              mobileSidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
            onClick={onCloseMobileSidebar}
            aria-hidden
          />
          {/* Drawer */}
          <div
            className={`fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-out ${
              mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            {sidebar}
          </div>
        </>
      ) : (
        sidebar
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {topBar}
        <div className="flex min-h-0 min-w-0 flex-1">
          {/*
            The desktop panel occupies space in document flow and the main area gives up width, so overflow-hidden covers wide tables / long code blocks that may overflow horizontally the instant it narrows. The mobile panel is an overlay, the main-area width does not change, and clipping is unnecessary.
          */}
          <main
            className={cn('min-h-0 min-w-0 flex-1', !isMobile && rightPanel && 'overflow-hidden')}
          >
            {children}
          </main>
          <AnimatedRightPanel open={rightPanelOpen} isMobile={isMobile} onClose={onCloseRightPanel}>
            {rightPanel}
          </AnimatedRightPanel>
        </div>
        {/* Disclaimer + agreement entry: pinned to the bottom of the main area and does not scroll with content. Filing record: see the login page / AdminLayout */}
        {hideFooter ? null : (
          <PlaygroundFooter className="shrink-0 bg-background/55 py-2 backdrop-blur-sm" />
        )}
      </div>
    </div>
  );
}

/** Shared duration and easing for the Drawer. Width, translation, and mask all use it, so making room and sliding in do not fall out of step. */
const PANEL_MOTION = 'duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)]';

/** Desktop panel width: 26rem as the base, shrinking to 36vw on a narrow screen so the body is not squeezed too narrow. */
const PANEL_WIDTH = 'w-[min(26rem,36vw)]';

interface AnimatedRightPanelProps {
  children?: React.ReactNode;
  open: boolean;
  /** A narrow screen (<lg) has no side-by-side space and degrades to an overlay drawer + mask. */
  isMobile: boolean;
  /** On mobile, click the mask to close. */
  onClose?: () => void;
}

/**
 * Layout-level right workspace, with symmetric enter and exit animations.
 *
 * Desktop is **non-modal side by side**: the panel occupies space in document flow, the main area gives up width, and both sides can be clicked / scrolled / typed in at once — which is what the source panel needs (keep following up while looking at sources). So desktop **does not render a mask**: a mask would turn the panel into a modal in practice, dimming and locking the body.
 *
 * A narrow screen has no side-by-side width and can only degrade to an overlay drawer + mask. The mask is then also the most convenient close target.
 *
 * On first mount, commit the collapsed state first, then enter the final state across two animation frames, so a React batched update does not make the panel appear directly.
 */
function AnimatedRightPanel({ children, open, isMobile, onClose }: AnimatedRightPanelProps) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!open) {
      // Reset the closed state first, so a later quick reopen can still enter from a definite starting frame.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEntered(false);
      return;
    }

    let secondFrame: number | undefined;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => setEntered(true));
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== undefined) window.cancelAnimationFrame(secondFrame);
    };
  }, [open]);

  if (!children) return null;

  const visible = open && entered;
  let motionState = 'closed';
  if (open) motionState = visible ? 'open' : 'opening';

  if (isMobile) {
    return (
      <>
        {/* Mask: the non-modal overlay stays at z-40 (the dropdown layer), under dialog (z-50) / toast (z-100) */}
        <div
          className={cn(
            'fixed inset-0 z-40 bg-foreground/20 backdrop-blur-[1px]',
            'transition-opacity duration-300 ease-out motion-reduce:transition-none',
            visible ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
          onClick={onClose}
          aria-hidden
          data-testid="playground-right-panel-overlay"
        />
        <div
          className={cn(
            'fixed inset-y-0 right-0 z-40 flex w-full flex-col overflow-hidden',
            'border-l border-border/35 bg-background/95 backdrop-blur-sm',
            'shadow-[-16px_0_36px_-30px_hsl(var(--foreground)/0.28)]',
            'transition-[opacity,transform]',
            PANEL_MOTION,
            'motion-reduce:transition-opacity motion-reduce:translate-x-0',
            visible
              ? 'translate-x-0 opacity-100'
              : 'pointer-events-none translate-x-full opacity-0',
          )}
          aria-hidden={!visible}
          data-state={motionState}
          data-testid="playground-right-panel"
        >
          {children}
        </div>
      </>
    );
  }

  /*
    Desktop: the outer layer owns width (pushing the main area open), and the inner layer owns translation and fade-in (sliding in). Two layers, because a width animation also compresses content and makes text jitter during the transition; the inner layer locks the final width and then translates as a whole, which looks clean.
  */
  return (
    <div
      className={cn(
        'relative min-h-0 shrink-0 overflow-hidden',
        'shadow-[-16px_0_36px_-30px_hsl(var(--foreground)/0.28)]',
        'transition-[width]',
        PANEL_MOTION,
        'motion-reduce:transition-none',
        visible ? PANEL_WIDTH : 'pointer-events-none w-0',
      )}
      aria-hidden={!visible}
      data-state={motionState}
      data-testid="playground-right-panel"
    >
      <div
        className={cn(
          'absolute inset-y-0 right-0 flex h-full flex-col overflow-hidden',
          PANEL_WIDTH,
          'border-l border-border/35 bg-background/80',
          'transition-[opacity,transform]',
          PANEL_MOTION,
          'motion-reduce:transition-opacity motion-reduce:translate-x-0',
          visible ? 'translate-x-0 opacity-100' : 'translate-x-6 opacity-0',
        )}
      >
        {children}
      </div>
    </div>
  );
}
