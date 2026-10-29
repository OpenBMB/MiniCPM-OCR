import { useId, useMemo, useRef, useState } from 'react';
import {
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useDismiss,
  useFloating,
  useInteractions,
  useListNavigation,
} from '@floating-ui/react';
import type { SearchSelectOption, SearchSelectProps } from './search-select.types';

/** Manages the searchable select’s popover, virtual keyboard focus, and separate search and selection state. */
export function useSearchSelect(props: SearchSelectProps) {
  const { search, selectedOptions, multiple, remote, disabled } = props;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<Array<HTMLElement | null>>([]);
  const listId = useId();
  const filtered = useMemo(() => {
    const selectedText =
      !multiple &&
      selectedOptions.some((option) => option.label === search || option.value === search);
    const query = selectedText ? '' : search.trim().toLowerCase();
    if (!query || remote) return props.options;
    return props.options.filter((option) =>
      [option.label, option.value, option.description ?? ''].some((text) =>
        text.toLowerCase().includes(query),
      ),
    );
  }, [multiple, props.options, remote, search, selectedOptions]);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-start',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        apply({ availableHeight, availableWidth, rects, elements }) {
          Object.assign(elements.floating.style, {
            width: `${Math.min(rects.reference.width, availableWidth)}px`,
            maxHeight: `${Math.max(0, Math.min(240, availableHeight))}px`,
          });
        },
      }),
    ],
  });
  const dismiss = useDismiss(context);
  const atLimit =
    multiple && props.maxSelected !== undefined && selectedOptions.length >= props.maxSelected;
  function isOptionDisabled(option: SearchSelectOption) {
    return Boolean(atLimit && !selectedOptions.some((selected) => selected.value === option.value));
  }
  const navigation = useListNavigation(context, {
    listRef,
    activeIndex,
    onNavigate: setActiveIndex,
    virtual: true,
    loop: true,
    enabled: !disabled,
    disabledIndices: filtered.flatMap((option, index) => (isOptionDisabled(option) ? [index] : [])),
  });
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    dismiss,
    navigation,
  ]);

  function choose(option: SearchSelectOption) {
    if (disabled || isOptionDisabled(option)) return;
    if (multiple) {
      const exists = selectedOptions.some((selected) => selected.value === option.value);
      props.onSelectionChange(
        exists
          ? selectedOptions.filter((selected) => selected.value !== option.value)
          : [...selectedOptions, option],
      );
      props.onSearchChange('');
      setActiveIndex(null);
    } else {
      props.onSelectionChange([option]);
      setOpen(false);
    }
  }

  function clear() {
    props.onSearchChange('');
    props.onSelectionChange([]);
    inputRef.current?.focus();
    setOpen(false);
  }

  function remove(option: SearchSelectOption) {
    props.onSelectionChange(selectedOptions.filter((selected) => selected.value !== option.value));
    inputRef.current?.focus();
    // A remove action only restores input focus, and must not reopen a candidate popover that was closed.
    setOpen(open);
  }

  function setInputReference(node: HTMLInputElement | null) {
    inputRef.current = node;
    refs.setReference(node);
  }

  function setOptionRef(index: number, node: HTMLButtonElement | null) {
    listRef.current[index] = node;
  }

  const inputProps = getReferenceProps({
    onFocus: () => setOpen(true),
    onClick: () => setOpen(true),
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      props.onSearchChange(event.target.value);
      setActiveIndex(null);
      setOpen(true);
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'Enter' && open) {
        const option = filtered[activeIndex ?? 0];
        if (option) {
          event.preventDefault();
          choose(option);
        }
      }
      if (event.key === 'Backspace' && !search && multiple && selectedOptions.length) {
        props.onSelectionChange(selectedOptions.slice(0, -1));
      }
    },
  });

  return {
    open,
    setOpen,
    activeIndex,
    filtered,
    inputRef,
    listId,
    setPositionReference: refs.setPositionReference,
    setFloating: refs.setFloating,
    setInputReference,
    setOptionRef,
    floatingStyles,
    context,
    inputProps,
    getFloatingProps,
    getItemProps,
    choose,
    clear,
    remove,
    isOptionDisabled,
  };
}
