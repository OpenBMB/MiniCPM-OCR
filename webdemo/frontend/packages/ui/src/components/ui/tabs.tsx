import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '../../utils';

/**
 * 标签页根容器。
 *
 * 用途：在同一视图内切换多组互斥内容（如任务看板的「全部/运行中/排队/完成/失败」筛选）。
 * 受控用 `value` + `onValueChange`，非受控用 `defaultValue`，行为由 Radix 处理。
 */
const Tabs = TabsPrimitive.Root;

interface IndicatorRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 量出当前选中 trigger 相对标签条的几何位置；没有选中项时返回 null */
function measureActive(list: HTMLElement): IndicatorRect | null {
  const active = list.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
  if (!active) return null;
  return {
    left: active.offsetLeft,
    top: active.offsetTop,
    width: active.offsetWidth,
    height: active.offsetHeight,
  };
}

/**
 * 标签条：segmented（分段控件）风格容器。
 *
 * 设计意图：用背景色差（bg-muted 底）+ 选中项阴影来区分，不依赖边框分隔，贴合平台
 * 「以阴影/背景色差代替 border」的视觉偏好。
 *
 * 选中态由一个绝对定位的指示器承载而不是画在 trigger 上，这样切换时它是「滑过去」
 * 而不是两块背景硬跳。位置靠测量 DOM 得到，因此纵向标签条、grid/flex-1 等布局、
 * 以及运行时增减标签都不用额外适配。要换指示器配色就覆盖
 * `[data-map-tabs-indicator]`（见 docs.css 的文档代码块标签）。
 */
const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, children, ...props }, ref) => {
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const [rect, setRect] = React.useState<IndicatorRect | null>(null);
  // 首帧只就位、不过渡，否则指示器会从左上角滑向初始选中项
  const [animated, setAnimated] = React.useState(false);

  const attachList = React.useCallback(
    (node: HTMLDivElement | null) => {
      listRef.current = node;
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref) {
        (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }
    },
    [ref],
  );

  React.useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const sync = () => setRect(measureActive(list));
    sync();
    const frame = requestAnimationFrame(() => setAnimated(true));

    // data-state 变化＝切了标签；childList 变化＝标签本身增减
    const mutation = new MutationObserver(sync);
    mutation.observe(list, {
      attributes: true,
      attributeFilter: ['data-state'],
      childList: true,
      subtree: true,
    });
    // 尺寸变化（响应式、文案换语言、字体加载完成）后重新贴合
    const resize = new ResizeObserver(sync);
    resize.observe(list);

    return () => {
      cancelAnimationFrame(frame);
      mutation.disconnect();
      resize.disconnect();
    };
  }, []);

  return (
    <TabsPrimitive.List
      ref={attachList}
      className={cn(
        'relative inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        data-map-tabs-indicator=""
        className={cn(
          'pointer-events-none absolute left-0 top-0 rounded-md bg-card shadow-sm',
          animated &&
            'transition-[transform,width,height] duration-200 ease-out motion-reduce:transition-none',
          !rect && 'opacity-0',
        )}
        style={
          rect
            ? {
                transform: `translate3d(${rect.left}px, ${rect.top}px, 0)`,
                width: rect.width,
                height: rect.height,
              }
            : undefined
        }
      />
      {children}
    </TabsPrimitive.List>
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

/**
 * 单个标签触发器。选中态只改文字色，背景与阴影交给标签条的滑动指示器；
 * `relative` 是必需的——要让文字叠在指示器上面。
 */
const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-[13px] font-medium ring-offset-background transition-colors duration-150',
      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30',
      'disabled:pointer-events-none disabled:opacity-50',
      'data-[state=active]:text-foreground',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

/**
 * 标签内容面板。仅在对应标签选中时渲染其子内容。
 */
const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn('mt-4 focus-visible:outline-none', className)}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
