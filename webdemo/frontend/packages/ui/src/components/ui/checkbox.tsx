import type { InputHTMLAttributes, Ref } from 'react';
import { cn } from '../../utils';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  ref?: Ref<HTMLInputElement>;
}

/**
 * 复选框原语。
 *
 * 用途：提供平台统一的 checkbox 外观与可访问状态。保留原生 input 语义，便于表单、
 * 键盘操作和屏幕阅读器直接识别；原生 accent-color 无法定制未选中态，视觉层隐藏
 * 外观后按语义 token 自绘：默认描边、hover 主色边、选中主色底加白勾。
 *
 * @param className 额外样式类，作用于外层容器（如对齐用的 margin）
 * @returns 语义化 checkbox 输入框
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
