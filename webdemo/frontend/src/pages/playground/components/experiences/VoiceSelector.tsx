/**
 * 可搜索的音色选择器。
 *
 * 用途：按场景在预置音色与当前用户保存的私有音色之间选择；名称和业务 ID 都可快速过滤。
 */

import { Search } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, Input } from '@map/ui';
import type { MapVoiceResource } from '@/api/map';

export interface VoiceSelectorOption {
  value: string;
  label: string;
  /** 用于快速搜索的补充文本，例如预置音色的内部标识。 */
  searchText?: string;
}

interface VoiceSelectorProps {
  value: string;
  onChange: (value: string) => void;
  presetOptions: VoiceSelectorOption[];
  savedVoices: MapVoiceResource[];
  /** 是否允许当前场景读取和展示用户私有音色。 */
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
 * 可搜索的音色选择器。
 * @param props 音色目录、当前值和分组展示文案
 * @returns 预置与私有音色的可访问选择控件
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
    // 选择后立即关闭并清空检索词，下一次打开时始终展示完整目录。
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
 * 音色候选分组。
 * @param props 分组标题与候选项
 * @returns 分组化的音色列表
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
 * 单个音色候选项。
 * @param props 当前选中状态、展示内容和选择动作
 * @returns 可点击的音色行
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
 * 判断音色名称或业务 ID 是否匹配搜索词。
 * @param label 音色展示名称
 * @param searchText 可选补充检索文本
 * @param query 已归一化的小写搜索词
 * @returns 是否应在当前候选中显示
 */
function matchesVoiceSearch(label: string, searchText: string | undefined, query: string): boolean {
  if (!query) return true;
  return `${label} ${searchText ?? ''}`.toLocaleLowerCase().includes(query);
}

/**
 * 解析当前值对应的展示名称。
 * @param value 当前选中的预置音色或私有音色 ID
 * @param presetOptions 预置音色目录
 * @param savedVoices 当前用户已保存的音色
 * @returns 用于触发按钮回显的音色名称
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
