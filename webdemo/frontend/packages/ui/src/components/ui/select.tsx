import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { cn } from '../../utils';

const Select = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      'group flex h-8 w-full items-center justify-between rounded-lg border border-input bg-card px-3 py-1.5 text-[13px]',
      'transition-[color,border-color,box-shadow] duration-150',
      'placeholder:text-muted-foreground/60',
      'hover:border-primary/30',
      'focus:outline-none',
      // 仅键盘聚焦时高亮；鼠标点选关闭后不留紫框（与 Input/Button 一致）
      'focus-visible:border-primary/50 focus-visible:ring-1 focus-visible:ring-primary/20',
      // 展开中保留轻微边框提示，收起后恢复默认
      'data-[state=open]:border-primary/30',
      'disabled:cursor-not-allowed disabled:opacity-50',
      '[&>span]:line-clamp-1',
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 text-muted-foreground/50 transition-transform duration-150 group-data-[state=open]:rotate-180"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectScrollUpButton = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn(
      'flex cursor-default items-center justify-center py-1 text-muted-foreground',
      className,
    )}
    {...props}
  >
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m18 15-6-6-6 6" />
    </svg>
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

const SelectScrollDownButton = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn(
      'flex cursor-default items-center justify-center py-1 text-muted-foreground',
      className,
    )}
    {...props}
  >
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName;

// Popper 定位依赖 transform，入场动画只用 opacity，避免与 Radix 定位/transform 冲突导致「跳一下」
const selectContentStyles = `
@keyframes map-select-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes map-select-out {
  from { opacity: 1; }
  to   { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .map-select-content {
    animation-duration: 0.01ms !important;
  }
}
.map-select-native-scroll [data-radix-select-viewport] {
  scrollbar-width: thin;
  -ms-overflow-style: auto;
  scrollbar-color: hsl(var(--border)) transparent;
}
.map-select-native-scroll [data-radix-select-viewport]::-webkit-scrollbar {
  display: block;
  width: 6px;
  height: 6px;
}
.map-select-native-scroll [data-radix-select-viewport]::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: hsl(var(--border));
}
`;

let selectKeyframesInjected = false;
function ensureSelectKeyframes() {
  if (selectKeyframesInjected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.textContent = selectContentStyles;
  document.head.appendChild(style);
  selectKeyframesInjected = true;
}

interface SelectContentProps extends React.ComponentPropsWithoutRef<
  typeof SelectPrimitive.Content
> {
  /** 列表滚动方式：buttons 保持 Radix 默认箭头；native 使用系统原生滚动条。 */
  scrollMode?: 'buttons' | 'native';
}

const SelectContent = React.forwardRef<HTMLDivElement, SelectContentProps>(
  (
    { className, children, position = 'popper', sideOffset = 4, scrollMode = 'buttons', ...props },
    ref,
  ) => {
    React.useEffect(() => {
      ensureSelectKeyframes();
    }, []);
    return (
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          ref={ref}
          sideOffset={sideOffset}
          className={cn(
            // 浮层层级须高于 Dialog（overlay/content 均为 z-50），否则在弹窗内打开下拉会被盖住
            'map-select-content relative z-[60] max-h-72 min-w-[8rem] overflow-hidden rounded-lg border border-border/60 bg-card text-card-foreground',
            scrollMode === 'native' && 'map-select-native-scroll',
            'shadow-[0_8px_30px_-4px_rgba(0,0,0,0.1),0_2px_8px_-2px_rgba(0,0,0,0.06)]',
            'data-[state=open]:[animation:map-select-in_150ms_ease-out]',
            'data-[state=closed]:[animation:map-select-out_120ms_ease-in]',
            className,
          )}
          position={position}
          {...props}
        >
          {scrollMode === 'buttons' && <SelectScrollUpButton />}
          <SelectPrimitive.Viewport
            className={cn(
              'p-1',
              position === 'popper' && 'min-w-[var(--radix-select-trigger-width)]',
              scrollMode === 'native' && 'max-h-72 overflow-y-auto overscroll-contain',
            )}
          >
            {children}
          </SelectPrimitive.Viewport>
          {scrollMode === 'buttons' && <SelectScrollDownButton />}
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    );
  },
);
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectLabel = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn(
      'px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60',
      className,
    )}
    {...props}
  />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

const SelectItem = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex w-full cursor-pointer select-none items-center rounded-md py-1.5 pl-8 pr-3 text-[13px] outline-none transition-colors duration-100',
      'focus:bg-primary/[0.06] focus:text-foreground',
      'data-[state=checked]:text-primary data-[state=checked]:font-medium',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-4 w-4 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-primary"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 my-1 h-px bg-border/60', className)}
    {...props}
  />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
};
