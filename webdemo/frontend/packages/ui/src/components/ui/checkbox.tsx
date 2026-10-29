import type { InputHTMLAttributes, Ref } from 'react';
import { cn } from '../../utils';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  ref?: Ref<HTMLInputElement>;
}

/**
 * Checkbox primitive.
 *
 * Purpose: the platform’s unified checkbox look and accessible state. Native input semantics stay, so forms,
 * keyboard use, and screen readers can recognize it directly. Native accent-color cannot style the unchecked state, so the visual layer hides
 * that appearance and paints from semantic tokens: a default stroke, a primary border on hover, and a primary fill with a white check when selected.
 *
 * @param className Extra classes, applied to the outer container (for example margin used for alignment).
 * @returns A semantic checkbox input.
 */
function Checkbox({ className, ref, ...props }: CheckboxProps) {
  return (
    <span className={cn('relative inline-flex size-4 shrink-0 items-center justify-center', className)}>
      <input
        ref={ref}
        type="checkbox"
        className={cn(
          'peer absolute inset-0 size-full cursor-pointer appearance-none rounded border border-input bg-background transition-colors',
          'hover:border-primary checked:border-primary checked:bg-primary',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
        {...props}
      />
      <svg
        aria-hidden="true"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none relative hidden size-2.5 text-primary-foreground peer-checked:block peer-disabled:opacity-50"
      >
        <path d="M2.5 6.5 5 9l4.5-5.5" />
      </svg>
    </span>
  );
}

export { Checkbox };
