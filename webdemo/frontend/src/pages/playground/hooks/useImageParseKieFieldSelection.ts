import { useState } from 'react';

/**
 * 管理字段多选与待确认删除快照，确认前不修改字段。
 * @param fields 当前字段
 * @param onChange 字段更新回调
 * @param disabled 是否禁止修改
 * @returns 选择状态、全选和确认删除入口
 */
export function useImageParseKieFieldSelection(
  fields: readonly string[],
  onChange: (fields: string[]) => void,
  disabled = false,
) {
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [pendingDeletion, setPendingDeletion] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const selected = fields.filter((field) => selection.includes(field));
  const allSelected = fields.length > 0 && selected.length === fields.length;
  const pendingCount = fields.filter((field) => pendingDeletion.includes(field)).length;

  function cancel() {
    setSelecting(false);
    setSelection([]);
    setConfirming(false);
    setPendingDeletion([]);
  }

  return {
    selecting,
    selected,
    allSelected,
    confirming,
    pendingCount,
    setConfirming,
    toggleMode: () => {
      if (disabled) return;
      if (selecting) cancel();
      else setSelecting(true);
    },
    toggle: (field: string) => {
      if (disabled) return;
      setSelection((current) =>
        current.includes(field) ? current.filter((item) => item !== field) : [...current, field],
      );
    },
    toggleAll: () => {
      if (!disabled) setSelection(allSelected ? [] : [...fields]);
    },
    requestDelete: () => {
      if (disabled || selected.length === 0) return;
      setPendingDeletion(selected);
      setConfirming(true);
    },
    confirmDelete: () => {
      if (disabled || !confirming || pendingCount === 0) return;
      onChange(fields.filter((field) => !pendingDeletion.includes(field)));
      cancel();
    },
  };
}
