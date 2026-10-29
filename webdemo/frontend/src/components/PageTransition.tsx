import type { ReactNode } from 'react';

interface PageTransitionProps {
  children: ReactNode;
}

/**
 * Top-level page entrance container.
 *
 * Purpose: holds the AdminLayout content region. It no longer mounts an entrance animation, so route-style tabs
 * or remounted content do not flash the whole page.
 */
export function PageTransition({ children }: PageTransitionProps) {
  return <div className="min-h-0 flex-1">{children}</div>;
}
