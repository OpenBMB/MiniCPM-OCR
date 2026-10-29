/** A searchable option has a stable identity, so display names may match or candidates may come from different server pages. */
export interface SearchSelectOption {
  value: string;
  label: string;
  description?: string;
}

/** The search keyword and the selected identity are controlled separately; single and multi select share the same popover interaction. */
export interface SearchSelectProps {
  options: readonly SearchSelectOption[];
  selectedOptions: readonly SearchSelectOption[];
  onSelectionChange: (next: SearchSelectOption[]) => void;
  search: string;
  onSearchChange: (search: string) => void;
  multiple?: boolean;
  maxSelected?: number;
  remote?: boolean;
  placeholder: string;
  className?: string;
  disabled?: boolean;
  loading?: boolean;
  emptyText?: string;
  loadingText?: string;
  loadingMore?: boolean;
  loadingMoreText?: string;
  hasMore?: boolean;
  onLoadMore?: () => void;
  clearLabel?: string;
  removeLabel?: (option: SearchSelectOption) => string;
  listLabel?: string;
}
