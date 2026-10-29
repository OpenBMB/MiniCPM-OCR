import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '../../utils';

/**
 * Tabs root.
 *
 * Purpose: switch among mutually exclusive groups in one view (for example a task board’s All / running / queued / done / failed filters).
 * Controlled with `value` plus `onValueChange`, uncontrolled with `defaultValue`; Radix handles the behavior.
 */
const Tabs = TabsPrimitive.Root;

interface IndicatorRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Measure the selected trigger’s geometry relative to the tab bar; returns null when nothing is selected. */
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
 * Tab bar: a segmented-control container.
 *
 * Intent: separate items with a background difference (bg-muted base) plus a shadow on the selected item, not with borders, matching the platform
 * preference to use shadow and background contrast instead of a border.
 *
 * The selected state is an absolutely positioned indicator rather than paint on the trigger, so a switch slides
 * instead of two backgrounds jumping. Position comes from measuring the DOM, so a vertical tab bar, grid or flex-1 layouts,
 * and tabs added or removed at runtime need no extra adaptation. To recolor the indicator, override
 * `[data-map-tabs-indicator]` (see the docs code-block tabs in docs.css).
 */
const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, children, ...props }, ref) => {
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const [rect, setRect] = React.useState<IndicatorRect | null>(null);
  // The first frame only settles in place, with no transition, or the indicator slides from the top-left toward the initial selection.
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

    // A data-state change means the tab changed; a childList change means tabs were added or removed.
    const mutation = new MutationObserver(sync);
    mutation.observe(list, {
      attributes: true,
      attributeFilter: ['data-state'],
      childList: true,
      subtree: true,
    });
    // After a size change (responsive layout, copy language, or fonts finishing load), fit the indicator again.
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
 * One tab trigger. The selected state only changes the text color; the background and shadow belong to the tab bar’s sliding indicator.
 * `relative` is required so the text stacks above the indicator.
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
 * Tab content panel. Renders its children only while the matching tab is selected.
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
