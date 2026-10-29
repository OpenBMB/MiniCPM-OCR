/**
 * 侧栏分组（标题 + 项列表）。
 *
 * 用途：渲染体验中心左侧栏的一个分组。项可为真功能（可点击）或占位（带「敬请期待」标，禁用）。
 */

import { Badge } from '@map/ui';

/** 单个侧栏项 */
export interface SidebarItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  /** 是否为占位项（禁用 + 待开放标） */
  placeholder?: boolean;
}

interface SidebarSectionProps {
  title: string;
  items: SidebarItem[];
  /** 当前激活项 key */
  activeKey?: string;
  /** 是否收起（仅显示图标） */
  collapsed?: boolean;
  onSelect?: (key: string) => void;
}

/**
 * 渲染一个侧栏分组。
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

/** 侧栏项的状态样式：占位 / 激活 / 普通 */
function itemStateClass(placeholder: boolean, active: boolean): string {
  if (placeholder) return 'cursor-not-allowed text-muted-foreground/50';
  if (active) return 'bg-primary/10 font-medium text-primary';
  return 'text-muted-foreground hover:bg-muted/60 hover:text-foreground';
}
