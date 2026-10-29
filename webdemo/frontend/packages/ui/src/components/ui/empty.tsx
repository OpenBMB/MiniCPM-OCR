import type { ReactNode } from 'react';
import { cn } from '../../utils';

export interface EmptyProps {
  icon?: ReactNode;
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

function Empty({ icon, title = '暂无数据', description, action, className }: EmptyProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-12 text-center', className)}>
      {icon || (
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-muted-foreground/20"
        >
          <rect x="2" y="6" width="20" height="12" rx="2" />
          <path d="M12 12h.01" />
        </svg>
      )}
      <p className="mt-3 text-sm font-medium text-muted-foreground">{title}</p>
      {description && <p className="mt-1 text-xs text-muted-foreground/60">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export { Empty };
