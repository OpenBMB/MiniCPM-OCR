/**
 * Sidebar group (title + item list).
 *
 * Purpose: render one group in the experience-center left sidebar. An item can be a real feature (clickable) or a placeholder (with a "coming soon" mark, disabled).
 */

import { Badge } from '@map/ui';

/** A single sidebar item */
export interface SidebarItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  /** Whether this is a placeholder item (disabled + not-yet-open mark) */
  placeholder?: boolean;
}

interface SidebarSectionProps {
  title: string;
  items: SidebarItem[];
  /** Key of the currently active item */
  activeKey?: string;
  /** Whether it is collapsed (icons only) */
  collapsed?: boolean;
  onSelect?: (key: string) => void;
}

/**
 * Renders one sidebar group.
 */
export function SidebarSection({
  title,
  items,
  activeKey,
  collapsed,
  onSelect,
}: SidebarSectionProps) {
  return (
    <div className="flex flex-col gap-0.5">
      {!collapsed && (
        <p className="px-3 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
          {title}
        </p>
      )}
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <button
            key={item.key}
            type="button"
            disabled={item.placeholder}
            onClick={() => !item.placeholder && onSelect?.(item.key)}
            title={collapsed ? item.label : undefined}
            className={[
              'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
              collapsed ? 'justify-center' : '',
              itemStateClass(Boolean(item.placeholder), active),
            ].join(' ')}
          >
            <span className="shrink-0">{item.icon}</span>
            {!collapsed && <span className="flex-1 truncate text-left">{item.label}</span>}
            {!collapsed && item.placeholder && (
              <Badge variant="secondary" className="px-1 py-0 text-[10px] font-normal">
                待开放
              </Badge>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** State styles for a sidebar item: placeholder / active / normal */
function itemStateClass(placeholder: boolean, active: boolean): string {
  if (placeholder) return 'cursor-not-allowed text-muted-foreground/50';
  if (active) return 'bg-primary/10 font-medium text-primary';
  return 'text-muted-foreground hover:bg-muted/60 hover:text-foreground';
}
