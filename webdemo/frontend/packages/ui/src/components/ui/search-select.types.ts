/** 可搜索选项使用稳定身份，允许展示名称相同或候选来自不同服务端分页。 */
export interface SearchSelectOption {
  value: string;
  label: string;
  description?: string;
}

/** 搜索关键词与已选身份分开受控，单选和多选共享同一浮层交互。 */
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
