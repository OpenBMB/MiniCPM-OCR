import type { Ref } from 'react';
import { cn } from '../../utils';

export interface SwitchProps {
  /** Whether it is on (controlled). */
  checked: boolean;
  /** Toggle callback; not fired when disabled. */
  onCheckedChange?: (checked: boolean) => void;
  /** Whether it is disabled (display only, not interactive). */
  disabled?: boolean;
  /** Accessible name when there is no visible copy. */
  'aria-label'?: string;
  /** Extra style classes. */
  className?: string;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * Switch primitive.
 *
 * Purpose: the platform’s unified on/off appearance, semantically one boolean (the kind of two-state setting
 * as "whether to show reasoning"). Implemented as a button with role="switch", so keyboard and screen readers can recognize it directly; when disabled
 * it only shows the current state and ignores clicks. Visuals use semantic tokens and adapt to dark mode.
 *
 * @param checked Whether it is currently on.
 * @param onCheckedChange Toggle callback (not fired when disabled).
 * @param disabled Whether it is disabled.
 * @param className Extra style classes.
 * @returns A semantic switch button.
 */
function Switch({ checked, onCheckedChange, disabled, className, ref, ...props }: SwitchProps) {
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-input',
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          'pointer-events-none inline-block size-4 rounded-full bg-background shadow transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

export { Switch };
