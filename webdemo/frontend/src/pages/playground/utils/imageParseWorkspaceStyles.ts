import { cn } from '@map/ui';

/** Shared header size for the left and right workspace columns, so different control padding does not misalign the divider. */
export const WORKSPACE_TOOLBAR =
  'flex min-h-11 shrink-0 flex-wrap items-center gap-y-1 border-b border-border/60 bg-card px-3 [@media(pointer:coarse)]:min-h-14';

/** Compact controls for the document workspace: 32px on desktop, and a 44px hit target kept on coarse-pointer devices. */
export const WORKSPACE_CONTROL =
  'h-8 min-h-8 rounded-md px-2.5 text-xs font-medium [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11';

/** Icon actions and text actions share height, radius, and focus rules. */
export const WORKSPACE_ICON_CONTROL =
  'h-8 w-8 min-h-8 shrink-0 rounded-md p-0 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11';

/** The segmented-control shell uses a thin stroke and fills only the selected item, so the whole group of buttons is not visually heavy. */
export const WORKSPACE_SEGMENT =
  'inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-border/70 bg-muted/40 p-px';

/** A segment is one step more compact than the shell; the touch size still matches the other actions. */
export const WORKSPACE_SEGMENT_ITEM =
  'h-7 min-h-7 rounded-md px-2.5 text-xs font-medium [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-h-11';

type PaneId = 'origin' | 'markdown';

/**
 * Document comparison split: on desktop, original-image width follows --map-split; on a narrow screen the panes stack.
 * @param pane original-image pane or recognition-result pane
 * @param dragging whether the divider is being dragged; when true, turn off the width transition
 */
export function paneClass(pane: PaneId, dragging: boolean, setup = false): string {
  return cn(
    // Confine the sticky top bar to its own pane, so it does not cover the divider's grab area.
    'isolate min-h-0 min-w-0 overflow-hidden bg-background',
    'transition-[flex] duration-200 ease-out motion-reduce:transition-none',
    dragging && 'transition-none',
    'h-[60svh] flex-none lg:h-full lg:flex-1',
    setup && pane === 'origin' && 'h-[40svh] min-h-64 lg:h-full',
    setup && pane === 'markdown' && 'h-auto min-h-64 lg:h-full',
    pane === 'origin' && 'lg:flex-[0_0_var(--map-split)]',
  );
}
