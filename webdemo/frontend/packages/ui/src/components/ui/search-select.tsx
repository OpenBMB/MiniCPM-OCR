import { FloatingFocusManager, FloatingPortal } from '@floating-ui/react';
import { Check, ChevronDown, LoaderCircle, X } from 'lucide-react';
import { cn } from '../../utils';
import { Button } from './button';
import { Input } from './input';
import { useSearchSelect } from './useSearchSelect';
import type { SearchSelectProps } from './search-select.types';

export type { SearchSelectOption, SearchSelectProps } from './search-select.types';

/**
 * 可搜索单选/多选：清除按钮与输入同行，已选项按身份回显，浮层支持键盘和远程分页。
 * @param props 搜索、候选、已选项及状态文案
 * @returns 可访问的组合框与独立定位的候选浮层
 */
export function SearchSelect({
  clearLabel = '清除',
  removeLabel = (option) => `移除 ${option.label}`,
  loadingText = '搜索中...',
  loadingMoreText = '加载更多中...',
  emptyText = '没有匹配的选项',
  ...props
}: SearchSelectProps) {
  const {
    open,
    setOpen,
    activeIndex,
    filtered,
    inputRef,
    listId,
    setPositionReference,
    setFloating,
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
  } = useSearchSelect(props);
  const { multiple, selectedOptions, search, disabled, placeholder } = props;
  return (
    <>
      <div
        ref={setPositionReference}
        data-search-select-control=""
        className={cn(
          'flex min-h-8 min-w-0 w-full self-start items-center gap-1 rounded-lg border border-input bg-card px-1.5 py-0.5 text-[13px]',
          'transition-colors hover:border-primary/30 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20',
          disabled && 'cursor-not-allowed opacity-50',
          props.className,
        )}
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {multiple &&
            selectedOptions.map((option) => (
              <span
                key={option.value}
                className="inline-flex max-w-full min-w-0 items-center gap-0.5 rounded bg-primary/10 pl-1.5 text-xs text-primary"
              >
                <span className="min-w-0 truncate" title={option.label}>
                  {option.label}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled}
                  aria-label={removeLabel(option)}
                  title={removeLabel(option)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => remove(option)}
                  className="size-6 shrink-0 rounded text-primary/70 hover:text-primary [@media(pointer:coarse)]:size-11"
                >
                  <X className="size-3" aria-hidden="true" />
                </Button>
              </span>
            ))}
          <Input
            {...inputProps}
            ref={setInputReference}
            role="combobox"
            aria-label={placeholder}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={
              open && activeIndex !== null && filtered[activeIndex]
                ? `${listId}-${activeIndex}`
                : undefined
            }
            placeholder={multiple && selectedOptions.length ? '' : placeholder}
            value={search}
            disabled={disabled}
            autoComplete="off"
            className="h-6 min-w-12 w-0 flex-1 rounded-none border-0 bg-transparent px-1.5 py-0 shadow-none focus-visible:ring-0 [@media(pointer:coarse)]:h-11"
          />
        </div>
        {search || selectedOptions.length ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label={clearLabel}
            title={clearLabel}
            onMouseDown={(event) => event.preventDefault()}
            onClick={clear}
            className="size-6 shrink-0 rounded text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:size-11"
          >
            <X className="size-3.5" aria-hidden="true" />
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label={props.listLabel ?? placeholder}
            aria-expanded={open}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              inputRef.current?.focus();
              setOpen(true);
            }}
            className="size-6 shrink-0 rounded text-muted-foreground [@media(pointer:coarse)]:size-11"
          >
            <ChevronDown className="size-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>
      {open && !disabled ? (
        <FloatingPortal>
          <FloatingFocusManager
            context={context}
            initialFocus={inputRef}
            modal={false}
            returnFocus={false}
          >
            <div
              {...getFloatingProps()}
              ref={setFloating}
              style={floatingStyles}
              id={listId}
              role="listbox"
              aria-label={props.listLabel ?? placeholder}
              aria-multiselectable={multiple || undefined}
              aria-busy={props.loading}
              onScroll={(event) => {
                const list = event.currentTarget;
                if (
                  list.scrollHeight - list.scrollTop - list.clientHeight <= 32 &&
                  props.hasMore &&
                  !props.loading &&
                  !props.loadingMore
                )
                  props.onLoadMore?.();
              }}
              className="z-40 overflow-y-auto overscroll-contain rounded-lg border border-border bg-card p-1 text-foreground shadow-card"
            >
              {!filtered.length ? (
                <p
                  role="status"
                  className="flex items-center gap-2 px-2.5 py-2 text-xs text-muted-foreground"
                >
                  {props.loading ? (
                    <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : null}
                  {props.loading ? loadingText : emptyText}
                </p>
              ) : (
                filtered.map((option, index) => {
                  const selected = selectedOptions.some((item) => item.value === option.value);
                  return (
                    <Button
                      {...getItemProps()}
                      ref={(node) => setOptionRef(index, node)}
                      id={`${listId}-${index}`}
                      key={option.value}
                      type="button"
                      variant="ghost"
                      role="option"
                      tabIndex={-1}
                      disabled={isOptionDisabled(option)}
                      aria-label={option.label}
                      aria-selected={selected}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => choose(option)}
                      className={cn(
                        'h-auto min-h-8 w-full justify-between gap-2 rounded px-2.5 py-2 text-left font-normal [@media(pointer:coarse)]:min-h-11',
                        activeIndex === index && 'bg-accent',
                        selected && 'text-primary',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate" title={option.label}>
                          {option.label}
                        </span>
                        {option.description ? (
                          <span
                            className="block truncate text-xs text-muted-foreground"
                            title={option.description}
                          >
                            {option.description}
                          </span>
                        ) : null}
                      </span>
                      <Check
                        className={cn('size-3.5 shrink-0', !selected && 'invisible')}
                        aria-hidden="true"
                      />
                    </Button>
                  );
                })
              )}
              {props.loadingMore ? (
                <p role="status" className="px-2.5 py-2 text-center text-xs text-muted-foreground">
                  {loadingMoreText}
                </p>
              ) : null}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      ) : null}
    </>
  );
}
