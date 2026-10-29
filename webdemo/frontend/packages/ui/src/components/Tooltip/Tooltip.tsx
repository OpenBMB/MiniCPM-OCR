import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { VariantProps, cva } from 'class-variance-authority';
import { cn } from '../../utils';

// Trigger styles (button or other trigger element).
const tooltipTriggerVariants = cva(
  'inline-flex items-center justify-center rounded-full focus:outline-none focus:ring-2 focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'bg-transparent hover:bg-muted text-muted-foreground focus:ring-ring',
        primary: 'bg-primary text-primary-foreground hover:bg-primary/90 focus:ring-primary',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90 focus:ring-destructive',
      },
      size: {
        sm: 'h-6 w-6 text-xs',
        md: 'h-8 w-8 text-sm',
        lg: 'h-10 w-10 text-base',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  },
);

// Tooltip content styles (the bubble).
const tooltipContentVariants = cva(
  'z-[70] overflow-hidden rounded-lg border px-3 py-1.5 text-sm shadow-[0_4px_16px_-2px_rgba(0,0,0,0.1),0_2px_4px_-1px_rgba(0,0,0,0.06)] data-[state=delayed-open]:[animation:map-tooltip-in_150ms_ease-out] data-[state=closed]:[animation:map-tooltip-out_100ms_ease-in]',
  {
    variants: {
      variant: {
        default: 'border-border/60 bg-card text-card-foreground',
        primary: 'border-primary/20 bg-primary/5 text-primary',
        destructive: 'border-destructive/20 bg-destructive/5 text-destructive',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

// Props types.
interface TooltipTriggerProps
  extends
    React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>,
    VariantProps<typeof tooltipTriggerVariants> {}

interface TooltipContentProps
  extends
    React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>,
    VariantProps<typeof tooltipContentVariants> {
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}

// Component implementation.
const TooltipProvider = TooltipPrimitive.Provider;

/**
 * Tooltip root.
 * Pulls Radix’s default 700ms hover delay down to 200ms so the hint feels more responsive (delayDuration can still override it).
 */
function Tooltip({
  delayDuration = 200,
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root delayDuration={delayDuration} {...props} />;
}

const TooltipTrigger = React.forwardRef<HTMLButtonElement, TooltipTriggerProps>(
  ({ className, variant, size, asChild, ...props }, ref) => (
    <TooltipPrimitive.Trigger
      ref={ref}
      asChild={asChild}
      className={asChild ? className : cn(tooltipTriggerVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
TooltipTrigger.displayName = TooltipPrimitive.Trigger.displayName;

const tooltipKeyframes = `
@keyframes map-tooltip-in {
  from { opacity: 0; transform: scale(0.96); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes map-tooltip-out {
  from { opacity: 1; transform: scale(1); }
  to   { opacity: 0; transform: scale(0.96); }
}
`;

let keyframesInjected = false;
function ensureKeyframes() {
  if (keyframesInjected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.textContent = tooltipKeyframes;
  document.head.appendChild(style);
  keyframesInjected = true;
}

const TooltipContent = React.forwardRef<HTMLDivElement, TooltipContentProps>(
  ({ className, side = 'bottom', align = 'center', variant, ...props }, ref) => {
    React.useEffect(() => {
      ensureKeyframes();
    }, []);
    return (
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          ref={ref}
          side={side}
          align={align}
          sideOffset={6}
          className={cn(tooltipContentVariants({ variant }), className)}
          {...props}
        />
      </TooltipPrimitive.Portal>
    );
  },
);
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent };
export type { TooltipTriggerProps, TooltipContentProps };
