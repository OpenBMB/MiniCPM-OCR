import type { Ref } from 'react';
import { cn } from '../../utils';

export interface SwitchProps {
  /** 是否开启（受控） */
  checked: boolean;
  /** 开关切换回调；disabled 时不触发 */
  onCheckedChange?: (checked: boolean) => void;
  /** 是否禁用（仅展示、不可操作） */
  disabled?: boolean;
  /** 无可见文案时的可访问名称 */
  'aria-label'?: string;
  /** 额外样式类 */
  className?: string;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * 开关原语。
 *
 * 用途：提供平台统一的开/关切换外观，语义等价单个布尔项（对应「是否展示思考」这类
 * 二态设置）。以 role="switch" 的 button 实现，键盘/屏幕阅读器可直接识别；disabled
 * 时仅展示当前态、不响应点击。视觉层统一走语义 token，暗色模式自动适配。
 *
 * @param checked 当前是否开启
 * @param onCheckedChange 切换回调（disabled 时不触发）
 * @param disabled 是否禁用
 * @param className 额外样式类
 * @returns 语义化开关按钮
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
