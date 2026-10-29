import type { ComponentProps } from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';

import { cn } from '../../utils';

/** Command menu root that can be used with mouse, touch, and keyboard. */
export const DropdownMenu = DropdownMenuPrimitive.Root;
/** Menu trigger; asChild reuses an existing button and keeps its focus and events. */
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

/** Selectable menu item; controlled state and keyboard interaction are handled by Radix. */
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
 * Menu popover: a Portal keeps the workbench from clipping it, and it repositions at the viewport edge.
 * @param props Radix menu content props.
 * @returns A command menu that uses design tokens.
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
 * Menu command item: shared touch size, keyboard highlight, and disabled state.
 * @param props Menu item and selection callback.
 * @returns A command item that supports keyboard navigation.
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
