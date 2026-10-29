import type { HTMLAttributes, Ref } from 'react';
import { cn } from '../../utils';

function Skeleton({
  className,
  ref,
  ...props
}: HTMLAttributes<HTMLDivElement> & { ref?: Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />
  );
}

export { Skeleton };
