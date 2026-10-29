import type { TextareaHTMLAttributes, Ref } from 'react';
import { cn } from '../../utils';

function Textarea({
  className,
  ref,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return (
    <textarea
      className={cn(
        'flex min-h-[68px] w-full rounded-lg border border-input bg-card px-3 py-1.5 text-[13px] transition-colors',
        'placeholder:text-muted-foreground/60',
        'focus-visible:outline-none focus-visible:border-primary/50 focus-visible:ring-1 focus-visible:ring-primary/20',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
}

export { Textarea };
