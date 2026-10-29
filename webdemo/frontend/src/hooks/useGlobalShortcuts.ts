import { useKeyPress, useMemoizedFn } from 'ahooks';
import { useNavigate } from 'react-router-dom';

/**
 * Global keyboard shortcuts for the platform.
 * Call once at the top-level layout.
 *
 * Shortcuts:
 *   Ctrl/Cmd + K  →  future: open command palette
 *   Ctrl/Cmd + \  →  toggle sidebar
 *
 * @example
 * useGlobalShortcuts({ onToggleSidebar: () => store.toggleSidebar() });
 */
export function useGlobalShortcuts({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
  const navigate = useNavigate();

  const handleToggleSidebar = useMemoizedFn(() => {
    onToggleSidebar?.();
  });

  const handleGoHome = useMemoizedFn(() => {
    navigate('/');
  });

  useKeyPress('ctrl.backslash', handleToggleSidebar);
  useKeyPress('meta.backslash', handleToggleSidebar);

  useKeyPress('alt.h', handleGoHome);
}
