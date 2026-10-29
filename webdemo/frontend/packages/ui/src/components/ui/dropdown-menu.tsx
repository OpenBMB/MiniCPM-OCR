import type { ComponentProps } from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';

import { cn } from '../../utils';

/** 可通过鼠标、触屏与键盘操作的命令菜单根节点。 */
export const DropdownMenu = DropdownMenuPrimitive.Root;
/** 菜单触发器；asChild 复用现有按钮并保留其焦点与事件。 */
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

/** 可选菜单项；受控状态和键盘交互由 Radix 统一处理。 */
export function DropdownMenuCheckboxItem({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      className={cn(
        'flex min-h-11 cursor-default select-none items-center gap-2 rounded-sm px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

/**
 * 菜单浮层：通过 Portal 避免工作台裁剪，并在视口边缘自动调整位置。
 * @param props Radix 菜单内容属性
 * @returns 使用设计 token 的命令菜单
 */
export function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-40 min-w-40 max-w-[calc(100vw-1rem)] rounded-md border border-border bg-card p-1 text-card-foreground shadow-md outline-none',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

/**
 * 菜单命令项：统一触控尺寸、键盘高亮和禁用状态。
 * @param props 菜单项与选择回调
 * @returns 支持键盘导航的命令项
 */
export function DropdownMenuItem({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        'flex min-h-11 cursor-default select-none items-center gap-2 rounded-sm px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
