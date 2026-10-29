import type { HTMLAttributes, Ref } from 'react';
import { cn } from '../../utils';

function Label({
  className,
  ref,
  ...props
}: HTMLAttributes<HTMLLabelElement> & { htmlFor?: string; ref?: Ref<HTMLLabelElement> }) {
  return (
    <label
      ref={ref}
      className={cn(
        'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className,
      )}
      {...props}
    />
  );
}

export { Label };
