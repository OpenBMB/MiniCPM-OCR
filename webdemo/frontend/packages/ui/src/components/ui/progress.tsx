import * as React from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import { cn } from '../../utils';

/**
 * Progress bar.
 *
 * Purpose: a 0–100 completion level (for example an evaluation task or a schedule sequence).
 * The track uses `bg-muted`, and the filled part defaults to `bg-primary`; `indicatorClassName`
 * can switch it to a semantic color (such as `bg-success` or `bg-destructive`) for a different state. Colors all come from tokens.
 *
 * @param value Current progress (0–100); undefined or null is treated as 0.
 * @param indicatorClassName Styles that override the filled part (used to change the semantic color).
 */
interface ProgressProps extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  value?: number | null;
  indicatorClassName?: string;
  /** When there is no real percentage, show a continuously moving in-progress state. */
  indeterminate?: boolean;
}

const Progress = React.forwardRef<React.ElementRef<typeof ProgressPrimitive.Root>, ProgressProps>(
  ({ className, value, indicatorClassName, indeterminate = false, ...props }, ref) => {
    // Clamp to [0, 100] so an out-of-range value cannot push the indicator out of the track.
    const clamped = Math.max(0, Math.min(100, value ?? 0));
    return (
      <ProgressPrimitive.Root
        ref={ref}
        className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)}
        value={indeterminate ? undefined : clamped}
        {...props}
      >
        <ProgressPrimitive.Indicator
          className={cn(
            'h-full w-full flex-1 bg-primary transition-all',
            indeterminate && 'w-1/3 animate-[map-progress-indeterminate_1.4s_ease-in-out_infinite]',
            indicatorClassName,
          )}
          style={indeterminate ? undefined : { transform: `translateX(-${100 - clamped}%)` }}
        />
      </ProgressPrimitive.Root>
    );
  },
);
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
export type { ProgressProps };
