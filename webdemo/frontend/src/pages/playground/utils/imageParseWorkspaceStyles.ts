import { cn } from '@map/ui';

/** 左右工作栏共用头部尺寸，避免控件留白不同导致分隔线错位。 */
export const WORKSPACE_TOOLBAR =
  'flex min-h-11 shrink-0 flex-wrap items-center gap-y-1 border-b border-border/60 bg-card px-3 [@media(pointer:coarse)]:min-h-14';

/** 文档工作台的紧凑控件：桌面 32px，粗指针设备保留 44px 点击目标。 */
export const WORKSPACE_CONTROL =
  'h-8 min-h-8 rounded-md px-2.5 text-xs font-medium [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11';

/** 图标操作与文字操作共用高度、圆角和焦点规则。 */
export const WORKSPACE_ICON_CONTROL =
  'h-8 w-8 min-h-8 shrink-0 rounded-md p-0 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11';

/** 分段控件外壳使用薄描边，仅选中项填充，避免整组按钮视觉过重。 */
export const WORKSPACE_SEGMENT =
  'inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-border/70 bg-muted/40 p-px';

/** 分段项比外壳紧凑一档，触屏尺寸仍与其他操作一致。 */
export const WORKSPACE_SEGMENT_ITEM =
  'h-7 min-h-7 rounded-md px-2.5 text-xs font-medium [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-h-11';

type PaneId = 'origin' | 'markdown';

/**
 * 文档对照分栏：桌面按 --map-split 调整原图宽度，窄屏上下排列。
 * @param pane 原图栏或识别结果栏
 * @param dragging 是否正在拖分隔条，为真时关掉宽度过渡
 */
export function paneClass(pane: PaneId, dragging: boolean, setup = false): string {
  return cn(
    // 将栏内的 sticky 顶栏限定在本栏，避免遮挡分隔条的抓取区。
    'isolate min-h-0 min-w-0 overflow-hidden bg-background',
    'transition-[flex] duration-200 ease-out motion-reduce:transition-none',
    dragging && 'transition-none',
    'h-[60svh] flex-none lg:h-full lg:flex-1',
    setup && pane === 'origin' && 'h-[40svh] min-h-64 lg:h-full',
    setup && pane === 'markdown' && 'h-auto min-h-64 lg:h-full',
    pane === 'origin' && 'lg:flex-[0_0_var(--map-split)]',
  );
}
