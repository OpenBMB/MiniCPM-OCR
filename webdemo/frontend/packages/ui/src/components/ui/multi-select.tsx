import { useEffect, useRef, useState } from 'react';
import { cn } from '../../utils';

export interface MultiSelectOption {
  value: string;
  label: string;
}

export interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  emptyText?: string;
  ariaLabel?: string;
  className?: string;
}

/**
 * Dropdown multi-select.
 *
 * Purpose: pick several options from a popover with a checkable list, and echo the selection as small tags inside the trigger (each tag can be removed on its own).
 * Compared with the flat {@link ChipMultiSelect}, it fits a longer option list that should not all be laid out (for example multi-selecting models).
 * The component is controlled; the caller owns the selected values. Internally it only toggles and returns the next selection, and it handles opening, closing, and outside clicks.
 *
 * @param options Option list.
 * @param value Currently selected values.
 * @param onChange Selection change callback.
 * @param placeholder Placeholder when nothing is selected.
 * @param emptyText Copy when there are no options.
 * @param ariaLabel Accessible name for the trigger.
 * @param className Outer container classes.
 * @returns The dropdown multi-select control.
 */
function MultiSelect({
  options,
  value,
  onChange,
  placeholder = '请选择',
  emptyText = '暂无可选项',
  ariaLabel,
  className,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // While the popover is open, listen for outside clicks and Esc to close it; @map/ui has no Popover or click-outside primitive yet, so this is inline.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  function toggle(next: string) {
    if (value.includes(next)) {
      onChange(value.filter((item) => item !== next));
      return;
    }
    onChange([...value, next]);
  }

  function remove(next: string) {
    onChange(value.filter((item) => item !== next));
  }

  // Echo only selected items that are still in options, so a filter does not leave stale tags behind.
  const selected = value
    .map((item) => options.find((option) => option.value === item))
    .filter((option): option is MultiSelectOption => Boolean(option));

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'group flex min-h-8 w-full items-center justify-between gap-1 rounded-lg border border-input bg-card px-2 py-1 text-[13px]',
          'transition-[color,border-color,box-shadow] duration-150 hover:border-primary/30',
          'focus:outline-none focus-visible:border-primary/50 focus-visible:ring-1 focus-visible:ring-primary/20',
          open && 'border-primary/30',
        )}
      >
        <span className="flex flex-1 flex-wrap items-center gap-1">
          {selected.length === 0 ? (
            <span className="px-1 text-muted-foreground/60">{placeholder}</span>
          ) : (
            selected.map((option) => (
              <span
                key={option.value}
                className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary"
              >
                {option.label}
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label={`移除 ${option.label}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    remove(option.value);
                  }}
                  className="cursor-pointer text-primary/60 transition-colors hover:text-primary"
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </span>
              </span>
            ))
          )}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn(
            'shrink-0 text-muted-foreground/50 transition-transform duration-150',
            open && 'rotate-180',
          )}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable
          className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-border bg-card p-1 shadow-card"
        >
          {options.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">{emptyText}</p>
          ) : (
            options.map((option) => {
              const active = value.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => toggle(option.value)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[13px]',
                    'transition-colors duration-150',
                    active ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted',
                  )}
                >
                  <span className="line-clamp-1">{option.label}</span>
                  {active && (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="shrink-0"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export { MultiSelect };
