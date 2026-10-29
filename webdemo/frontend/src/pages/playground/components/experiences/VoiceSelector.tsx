/**
 * Searchable voice selector.
 *
 * Purpose: choose, by scene, between preset voices and private voices saved by the current user; both the name and the business ID can be filtered quickly.
 */

import { Search } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, Input } from '@map/ui';
import type { MapVoiceResource } from '@/api/map';

export interface VoiceSelectorOption {
  value: string;
  label: string;
  /** Extra text for quick search, for example a preset voice's internal identifier. */
  searchText?: string;
}

interface VoiceSelectorProps {
  value: string;
  onChange: (value: string) => void;
  presetOptions: VoiceSelectorOption[];
  savedVoices: MapVoiceResource[];
  /** Whether the current scene may read and show the user's private voices. */
  allowSavedVoices?: boolean;
  disabled?: boolean;
  loading?: boolean;
  ariaLabel: string;
  searchPlaceholder: string;
  presetGroupLabel: string;
  savedGroupLabel: string;
  noResultsLabel: string;
}

/**
 * Searchable voice selector.
 * @param props Voice catalog, current value, and group display copy
 * @returns An accessible select control for preset and private voices
 */
export function VoiceSelector({
  value,
  onChange,
  presetOptions,
  savedVoices,
  allowSavedVoices = true,
  disabled = false,
  loading = false,
  ariaLabel,
  searchPlaceholder,
  presetGroupLabel,
  savedGroupLabel,
  noResultsLabel,
}: VoiceSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleSavedVoices = allowSavedVoices ? savedVoices : [];
  const selectedLabel = findVoiceLabel(value, presetOptions, visibleSavedVoices);
  const matchingPresets = useMemo(
    () =>
      presetOptions.filter((option) =>
        matchesVoiceSearch(option.label, option.searchText, normalizedQuery),
      ),
    [normalizedQuery, presetOptions],
  );
  const matchingSaved = useMemo(
    () =>
      visibleSavedVoices.filter((voice) =>
        matchesVoiceSearch(voice.name, voice.id, normalizedQuery),
      ),
    [normalizedQuery, visibleSavedVoices],
  );
  const empty = matchingPresets.length === 0 && matchingSaved.length === 0;

  function handleChange(nextValue: string) {
    // Close immediately after a selection and clear the query, so the next open always shows the full catalog.
    setQuery('');
    setOpen(false);
    onChange(nextValue);
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) setQuery('');
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button
        type="button"
        variant="outline"
        className="h-9 w-full justify-between font-normal"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled || loading}
        onClick={() => setOpen(true)}
      >
        <span className="min-w-0 truncate text-left">{selectedLabel}</span>
        <span className="ml-3 shrink-0 text-xs text-muted-foreground">选择</span>
      </Button>
      <DialogContent className="sm:max-w-lg" onClose={() => handleOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>{ariaLabel}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-col gap-4">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              autoFocus
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="h-10 pl-9"
            />
          </div>
          <div className="max-h-[50vh] overflow-y-auto" role="listbox" aria-label={ariaLabel}>
            {matchingPresets.length > 0 && (
              <VoiceOptionGroup label={presetGroupLabel}>
                {matchingPresets.map((option) => (
                  <VoiceOption
                    key={option.value}
                    active={option.value === value}
                    label={option.label}
                    onSelect={() => handleChange(option.value)}
                  />
                ))}
              </VoiceOptionGroup>
            )}
            {matchingSaved.length > 0 && (
              <VoiceOptionGroup label={savedGroupLabel}>
                {matchingSaved.map((voice) => (
                  <VoiceOption
                    key={voice.id}
                    active={voice.id === value}
                    label={voice.name}
                    detail={voice.id}
                    onSelect={() => handleChange(voice.id)}
                  />
                ))}
              </VoiceOptionGroup>
            )}
            {empty && (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                {noResultsLabel}
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface VoiceOptionGroupProps {
  label: string;
  children: ReactNode;
}

/**
 * A group of voice candidates.
 * @param props Group title and candidates
 * @returns A grouped voice list
 */
function VoiceOptionGroup({ label, children }: VoiceOptionGroupProps) {
  return (
    <section className="mb-4 last:mb-0" aria-label={label}>
      <p className="mb-1 px-3 text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-col gap-1">{children}</div>
    </section>
  );
}

interface VoiceOptionProps {
  active: boolean;
  label: string;
  detail?: string;
  onSelect: () => void;
}

/**
 * A single voice candidate.
 * @param props Current selected state, display content, and selection action
 * @returns A clickable voice row
 */
function VoiceOption({ active, label, detail, onSelect }: VoiceOptionProps) {
  return (
    <Button
      type="button"
      variant={active ? 'secondary' : 'ghost'}
      className="h-auto min-h-11 w-full justify-start px-3 py-2 text-left"
      role="option"
      aria-selected={active}
      onClick={onSelect}
    >
      <span className="min-w-0">
        <span className="block truncate">{label}</span>
        {detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
      </span>
    </Button>
  );
}

/**
 * Decide whether a voice name or business ID matches the search query.
 * @param label Voice display name
 * @param searchText Optional extra search text
 * @param query Normalized lowercase search query
 * @returns Whether it should be shown among the current candidates
 */
function matchesVoiceSearch(label: string, searchText: string | undefined, query: string): boolean {
  if (!query) return true;
  return `${label} ${searchText ?? ''}`.toLocaleLowerCase().includes(query);
}

/**
 * Resolve the display name for the current value.
 * @param value Currently selected preset-voice or private-voice ID
 * @param presetOptions Preset-voice catalog
 * @param savedVoices Voices already saved by the current user
 * @returns Voice name shown back on the trigger button
 */
function findVoiceLabel(
  value: string,
  presetOptions: VoiceSelectorOption[],
  savedVoices: MapVoiceResource[],
): string {
  return (
    presetOptions.find((option) => option.value === value)?.label ??
    savedVoices.find((voice) => voice.id === value)?.name ??
    value
  );
}
