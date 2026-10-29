import { cn } from '../../utils';

export interface ChipMultiSelectOption {
  value: string;
  label: string;
}

export interface ChipMultiSelectProps {
  options: ChipMultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  emptyText?: string;
  ariaLabel?: string;
  className?: string;
}

/**
 * Chip multi-select.
 *
 * Purpose: pick several finite options as clickable tags, suited to short labels such as models, datasets, and tag filters.
 * The component stays controlled; the caller owns the selected values. Internally it only toggles and returns the next selection.
 *
 * @param options Option list.
 * @param value Currently selected values.
 * @param onChange Selection change callback.
 * @param emptyText Copy shown when there are no options.
 * @param ariaLabel Accessible name for the multi-select region.
 * @param className Outer style classes.
 * @returns The chip multi-select control.
 */
function ChipMultiSelect({
  options,
  value,
  onChange,
  emptyText = '暂无可选项',
  ariaLabel,
  className,
}: ChipMultiSelectProps) {
  function toggle(nextValue: string) {
    if (value.includes(nextValue)) {
      onChange(value.filter((item) => item !== nextValue));
      return;
    }
    onChange([...value, nextValue]);
  }

  if (options.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div role="group" aria-label={ariaLabel} className={cn('flex flex-wrap gap-1.5', className)}>
      {options.map((option) => {
        const active = value.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => toggle(option.value)}
            aria-pressed={active}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-[color,background-color] duration-150',
              'focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/30',
              active
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export { ChipMultiSelect };
