import * as React from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import { cn } from '../../utils';

/**
 * 进度条。
 *
 * 用途：表示一个 0–100 的完成度（如评测任务进度、调度序列完成率）。
 * 轨道用 `bg-muted`，已完成段默认 `bg-primary`；可通过 `indicatorClassName`
 * 换成语义色（如 `bg-success`/`bg-destructive`）以表达不同状态，颜色全走 token。
 *
 * @param value 当前进度值（0–100），传入 undefined/null 视为 0
 * @param indicatorClassName 覆盖已完成段的样式（用于换语义色）
 */
interface ProgressProps extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  value?: number | null;
  indicatorClassName?: string;
  /** 没有真实百分比时展示持续运动的处理中状态。 */
  indeterminate?: boolean;
}

const Progress = React.forwardRef<React.ElementRef<typeof ProgressPrimitive.Root>, ProgressProps>(
  ({ className, value, indicatorClassName, indeterminate = false, ...props }, ref) => {
    // 约束到 [0,100]，避免越界值把指示条推出轨道
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
