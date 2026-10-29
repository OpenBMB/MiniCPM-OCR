import type { HTMLAttributes, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@map/ui';

interface NavItemButtonProps extends HTMLAttributes<HTMLElement> {
  to: string;
  children: ReactNode;
  /** 外部链接：设置后渲染为锚点，点击在新标签页打开，不走内部路由 */
  external?: string;
}

/**
 * 导航按钮：内部路由用编程式跳转，避免 hover 时浏览器左下角显示链接地址；
 * 传入 external 时渲染为锚点，在新标签页打开外部地址。
 */
export function NavItemButton({
  to,
  external,
  className,
  onClick,
  children,
  ...props
}: NavItemButtonProps) {
  const navigate = useNavigate();

  // 外部链接：新标签页打开，rel 阻断 opener 引用泄露。
  if (external) {
    return (
      <a
        href={external}
        target="_blank"
        rel="noopener noreferrer"
        className={cn('border-0 bg-transparent p-0 text-left no-underline', className)}
        onClick={onClick}
        {...props}
      >
        {children}
      </a>
    );
  }

  return (
    <button
      type="button"
      className={cn('border-0 bg-transparent p-0 text-left', className)}
      onClick={(e) => {
        onClick?.(e);
        navigate(to);
      }}
      {...props}
    >
      {children}
    </button>
  );
}
