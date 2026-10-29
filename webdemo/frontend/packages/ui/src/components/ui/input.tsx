import type { InputHTMLAttributes, Ref } from 'react';
import { cn } from '../../utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  ref?: Ref<HTMLInputElement>;
}

function Input({ className, type, ref, ...props }: InputProps) {
  return (
    <input
      type={type}
      className={cn(
        'flex h-8 w-full rounded-lg border border-input bg-card px-3 py-1.5 text-[13px] transition-colors',
        'file:border-0 file:bg-transparent file:text-[13px] file:font-medium file:text-foreground',
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

export { Input };
