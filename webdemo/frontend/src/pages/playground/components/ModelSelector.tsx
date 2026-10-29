/**
 * Model selector (top bar).
 *
 * Purpose: choose the chat model from the callable model list (a real feature).
 */

import { Select, SelectContent, SelectItem, SelectTrigger } from '@map/ui';
import { useTranslation } from 'react-i18next';
import type { MapModel } from '@/api/map';
import { LimitedFreeTag } from '@/components/LimitedFreeTag';
import { useBreakpoint } from '@/hooks/useResponsive';
import { isFreeModel } from '@/utils/modelExperience';

interface ModelSelectorProps {
  models: MapModel[];
  loading: boolean;
  value: string;
  onChange: (id: string) => void;
}

/**
 * Model dropdown.
 * @param models Model list
 * @param loading List loading state
 * @param value Currently selected id
 * @param onChange Selection callback
 */
export function ModelSelector({ models, loading, value, onChange }: ModelSelectorProps) {
  const { t } = useTranslation('playground');
  const selected = models.find((m) => m.id === value);
  const isMobile = !useBreakpoint('lg');

  return (
    <div className="flex min-w-0 max-w-full items-center gap-2">
      <Select value={value} onValueChange={onChange} disabled={loading || models.length === 0}>
        {/* The trigger shows a single horizontal row (name + context). Do not use SelectValue, so mirroring the dropdown item's two-line layout does not look like a "line wrap" */}
        {/* A "bare" trigger inside the top bar: explicitly clear the base component's focus/open border and ring so no purple frame lingers after switching */}
        <SelectTrigger className="h-9 w-auto min-w-0 max-w-full gap-2 border-0 bg-transparent px-2 shadow-none hover:bg-muted/60 hover:border-0 focus-visible:border-0 focus-visible:ring-0 data-[state=open]:border-0">
          {selected ? (
            // Wrap with a div: avoid SelectTrigger's [&>span]:line-clamp-1 changing display to -webkit-box,
            // otherwise flex/gap are overridden and the name sticks to the context.
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="truncate font-semibold">{selected.display_name || selected.id}</span>
              {isFreeModel(selected) && <LimitedFreeTag />}
              {selected.context_window > 0 && (
                <span className="hidden shrink-0 text-xs font-normal text-muted-foreground sm:inline">
                  {formatWindow(selected.context_window, t)}
                </span>
              )}
              {selected.parameter_count && (
                <span className="hidden shrink-0 text-xs font-normal text-muted-foreground sm:inline">
                  {selected.parameter_count}
                </span>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground">
              {loading ? t('modelsLoading') : t('selectModel')}
            </span>
          )}
        </SelectTrigger>
        <SelectContent side={isMobile ? 'top' : undefined} scrollMode="native">
          {models.map((m) => {
            const name = m.display_name || m.id;
            // Show the id in the subtitle only when it differs from the display name, so "name + name · context" is not repeated
            const showId = Boolean(m.display_name) && m.display_name !== m.id;
            // The subtitle is assembled as "id · context," and a missing piece is omitted — when there is no context window, do not leave a lone "—"
            const subtitle = [
              showId ? m.id : '',
              m.parameter_count || '',
              m.context_window > 0 ? formatWindow(m.context_window, t) : '',
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <SelectItem key={m.id} value={m.id}>
                <div className="flex flex-col">
                  <span className="font-medium">
                    {name}
                    {isFreeModel(m) && <LimitedFreeTag className="ml-2 align-middle" />}
                  </span>
                  {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Friendly display of the context window (for example, 128K) */
function formatWindow(
  n: number,
  t: (key: string, options: { count: string | number }) => string,
): string {
  if (!n) return '—';
  return t('contextWindow', { count: n >= 1000 ? `${Math.round(n / 1000)}K` : n });
}
