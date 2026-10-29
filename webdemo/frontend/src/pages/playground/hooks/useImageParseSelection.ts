import { useCallback, useState } from 'react';

type Source = 'origin' | 'result';

/** Isolate click positioning and temporary hover by result identity; leaving the hover area does not clear the block already selected. */
export function useImageParseSelection(key: string, enabled: boolean, linked: boolean) {
  const [selection, setSelection] = useState<{
    key: string;
    id: string;
    request: number;
    source: Source;
  }>();
  const [hover, setHover] = useState<{ key: string; id: string }>();
  const hoverBlock = useCallback(
    (id: string | undefined, targetKey = key) => {
      setHover((current) => {
        if (current?.key === targetKey && current.id === id) return current;
        return id ? { key: targetKey, id } : undefined;
      });
    },
    [key],
  );
  return {
    selectedId: enabled && selection?.key === key ? selection.id : undefined,
    hoveredId: enabled && linked && hover?.key === key ? hover.id : undefined,
    originFocus:
      linked && selection?.key === key && selection.source === 'result'
        ? selection.request
        : undefined,
    resultFocus:
      linked && selection?.key === key && selection.source === 'origin'
        ? selection.request
        : undefined,
    select(id: string, source: Source, targetKey = key) {
      setSelection((current) => ({
        key: targetKey,
        id,
        source,
        request: (current?.request ?? 0) + 1,
      }));
    },
    hover: hoverBlock,
    reset() {
      setSelection(undefined);
      setHover(undefined);
    },
  };
}
