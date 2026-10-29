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
 * Chip 多选组件。
 *
 * 用途：以可点选标签形式选择多个有限选项，适合模型、数据集、标签过滤等短文本选项。
 * 组件保持受控，选中值由调用方持有；内部只负责切换并返回下一组选中值。
 *
 * @param options 可选项列表
 * @param value 当前选中的 value 列表
 * @param onChange 选中变更回调
 * @param emptyText 空选项文案
 * @param ariaLabel 多选区域的无障碍名称
 * @param className 外层样式类
 * @returns chip 多选控件
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
