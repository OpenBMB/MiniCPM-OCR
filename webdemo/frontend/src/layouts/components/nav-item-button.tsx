import type { HTMLAttributes, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@map/ui';

interface NavItemButtonProps extends HTMLAttributes<HTMLElement> {
  to: string;
  children: ReactNode;
  /** External link: when set, render an anchor that opens in a new tab and does not use internal routing. */
  external?: string;
}

/**
 * Nav button: internal routes use a programmatic jump so hover does not show the URL in the browser status bar;
 * when external is passed, render an anchor that opens the external address in a new tab.
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

  // External link: open in a new tab, and use rel to block opener leaks.
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
