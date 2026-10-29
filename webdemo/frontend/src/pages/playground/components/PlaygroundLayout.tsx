/**
 * 体验中心全屏外壳。
 *
 * 用途：左侧栏 + 右侧主区（顶栏 + 内容 + 底部免责声明）的全屏布局。
 * 桌面端（≥lg）侧栏常驻并排；移动端侧栏改为抽屉（fixed 滑出 + 遮罩），主区占满全宽。
 * 纯结构组件，不含业务逻辑。
 *
 * 备案说明：体验中心用独立全屏壳，底部不放备案（备案已在登录页与 AdminLayout 下的
 * 全部业务页常驻展示），此处改为「AI 生成内容免责声明 + 协议入口」。
 */

import { useEffect, useState } from 'react';

import { cn } from '@map/ui';

import { PlaygroundFooter } from './PlaygroundFooter';

interface PlaygroundLayoutProps {
  sidebar: React.ReactNode;
  topBar: React.ReactNode;
  children: React.ReactNode;
  /** 是否为移动端（<lg）：侧栏转抽屉，右侧工作区转覆盖式 */
  isMobile: boolean;
  /** 移动端抽屉是否打开 */
  mobileSidebarOpen: boolean;
  /** 关闭移动端抽屉（点遮罩） */
  onCloseMobileSidebar: () => void;
  /** 语言模型主区右侧的非模态工作区。 */
  rightPanel?: React.ReactNode;
  /** 右侧工作区是否展开。 */
  rightPanelOpen?: boolean;
  /** 关闭右侧工作区；桌面端非模态不需要，仅移动端点遮罩时触发。 */
  onCloseRightPanel?: () => void;
  /** 图像解析等工作台自带顶栏时，不再叠体验中心免责条 */
  hideFooter?: boolean;
}

/**
 * 全屏外壳。用 h-dvh + 100vh 回退适配移动端地址栏。
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
          {/* 遮罩 */}
          <div
            className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 ${
              mobileSidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
            onClick={onCloseMobileSidebar}
            aria-hidden
          />
          {/* 抽屉 */}
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
            桌面端面板在文档流里占位，主区让出宽度，所以要 overflow-hidden 兜住收窄瞬间
            可能横向溢出的宽表格／长代码块；移动端面板是覆盖式，主区宽度不变，无需裁剪。
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
        {/* 免责声明 + 协议入口：固定贴在主区底部，不随内容滚动。备案见登录页/AdminLayout */}
        {hideFooter ? null : (
          <PlaygroundFooter className="shrink-0 bg-background/55 py-2 backdrop-blur-sm" />
        )}
      </div>
    </div>
  );
}

/** Drawer 统一的时长与缓动，宽度、位移、遮罩三者共用，让位与滑入才不会脱节。 */
const PANEL_MOTION = 'duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)]';

/** 桌面端面板宽度：26rem 打底，窄屏按 36vw 收，避免把正文挤得过窄。 */
const PANEL_WIDTH = 'w-[min(26rem,36vw)]';

interface AnimatedRightPanelProps {
  children?: React.ReactNode;
  open: boolean;
  /** 窄屏（<lg）没有并排空间，退化为覆盖式抽屉 + 遮罩。 */
  isMobile: boolean;
  /** 移动端点遮罩关闭。 */
  onClose?: () => void;
}

/**
 * 布局级右侧工作区，带对称的进入与退出动画。
 *
 * 桌面端是**非模态并排**：面板在文档流里占位、主区让出宽度，左右两侧同时可点击 / 滚动 /
 * 输入——这正是来源面板要的（边对着来源边继续追问）。所以桌面端**不渲染遮罩**：遮罩会把
 * 面板变成事实上的模态，压暗并锁死正文。
 *
 * 窄屏没有并排的宽度，只能退化成覆盖式抽屉 + 遮罩，此时遮罩同时是最顺手的关闭落点。
 *
 * 首次挂载时先提交收起态，再跨两个动画帧进入终态，避免 React 批量更新让面板直接出现。
 */
function AnimatedRightPanel({ children, open, isMobile, onClose }: AnimatedRightPanelProps) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!open) {
      // 关闭态先复位，后续快速重新打开仍能从明确的起始帧进入。
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
        {/* 遮罩：非模态浮层停在 z-40（dropdown 层），留在 dialog(z-50) / toast(z-100) 之下 */}
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
    桌面端：外层管宽度（把主区推开）、内层管位移与淡入（滑进来）。分两层是因为宽度动画会
    连带压缩内容、让文字在过渡期抖动；内层固定住最终宽度再整体平移，观感才干净。
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
