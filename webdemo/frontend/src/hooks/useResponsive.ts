import { useResponsive as useAhooksResponsive } from 'ahooks';

export type Breakpoint = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

const breakpoints: Record<Breakpoint, number> = {
  xs: 0,
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
};

/**
 * Tailwind-aligned responsive breakpoints via ahooks.
 *
 * @example
 * const responsive = useResponsive();
 * if (!responsive.lg) return <MobileLayout />;
 */
export function useResponsive() {
  return useAhooksResponsive() as Record<Breakpoint, boolean>;
}

/**
 * Check if current viewport matches a minimum breakpoint.
 *
 * @example
 * const isMobile = !useBreakpoint('lg');
 * const isDesktop = useBreakpoint('xl');
 */
export function useBreakpoint(bp: Breakpoint) {
  const responsive = useAhooksResponsive() as Record<Breakpoint, boolean>;
  return responsive[bp] ?? false;
}

// Configure ahooks responsive breakpoints to match Tailwind
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__AHOOKS_RESPONSIVE_CONFIG__ = breakpoints;
}
