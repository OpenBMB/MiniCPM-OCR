import { useId } from 'react';
import { CircleAlert, ListFilter, Plus, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, Textarea, cn } from '@map/ui';

import { MAX_IMAGE_PARSE_KIE_FIELDS } from '../../utils/imageParseKie';
import type { useImageParseKieFieldEditor } from '../../hooks/useImageParseKieFieldEditor';
import type { useImageParseKieFieldSelection } from '../../hooks/useImageParseKieFieldSelection';
import { WORKSPACE_CONTROL } from '../../utils/imageParseWorkspaceStyles';
import { ImageParseToolButton } from './ImageParseToolButton';

interface ImageParseKieFieldsProps {
  fields: readonly string[];
  onChange: (fields: string[]) => void;
  editor: ReturnType<typeof useImageParseKieFieldEditor>;
  selection: ReturnType<typeof useImageParseKieFieldSelection>;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  disabled?: boolean;
}

/**
 * 关键信息抽取字段区。列表下方添加字段，选择模式支持批量删除；
 * 字段在进入请求前会再次由 API 层和后端校验。
 */
export function ImageParseKieFields({
  fields,
  onChange,
  editor,
  selection,
  editing,
  onEditingChange,
  disabled = false,
}: ImageParseKieFieldsProps) {
  const { t } = useTranslation('playground');
  const { draft, error } = editor;
  const full = fields.length >= MAX_IMAGE_PARSE_KIE_FIELDS;
  const inputId = useId();
  const helpId = useId();
  const errorId = useId();

  function submitField() {
    if (editor.add()) onEditingChange(false);
  }

  return (
    <section
      aria-label={t('imageParseKieFields')}
      data-image-parse-kie-fields=""
      className="flex min-w-0 flex-col gap-4"
    >
      {selection.selecting ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-foreground">
            <Checkbox
              checked={selection.allSelected}
              ref={(input) => {
                if (input)
                  input.indeterminate = selection.selected.length > 0 && !selection.allSelected;
              }}
              disabled={disabled}
              onChange={selection.toggleAll}
            />
            {t('imageParseKieSelectAll')}
          </label>
          <Button
            type="button"
            variant="ghost"
            disabled={disabled || selection.selected.length === 0}
            onClick={selection.requestDelete}
            className={cn(
              WORKSPACE_CONTROL,
              'gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive',
            )}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            {t('imageParseKieDeleteSelected', { count: selection.selected.length })}
          </Button>
        </div>
      ) : null}

      {fields.length > 0 ? (
        <ol
          className="flex list-none flex-wrap gap-2 p-0"
          aria-label={t('imageParseKieAddedFields')}
          aria-live="polite"
        >
          {fields.map((field, index) => (
            <li
              key={field}
              className={cn(
                'group/field flex min-h-9 max-w-full min-w-0 items-center gap-1.5 rounded-lg border border-border/70 bg-card transition-[border-color,background-color] duration-150 motion-reduce:transition-none',
                selection.selecting ? 'p-0' : 'py-1 pl-2.5 pr-1',
                selection.selecting &&
                  selection.selected.includes(field) &&
                  'border-primary/40 bg-primary/5',
              )}
              data-kie-field=""
            >
              {selection.selecting ? (
                <label className="flex min-h-11 min-w-0 cursor-pointer items-center gap-2 px-2.5 py-1">
                  <Checkbox
                    checked={selection.selected.includes(field)}
                    disabled={disabled}
                    aria-label={t('imageParseKieSelectField', { field })}
                    onChange={() => selection.toggle(field)}
                  />
                  <span className="min-w-0 break-words text-[13px] font-medium text-foreground">
                    {field}
                  </span>
                </label>
              ) : (
                <>
                  <span
                    className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground/70"
                    aria-hidden="true"
                  >
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 break-words text-[13px] font-medium text-foreground">
                    {field}
                  </span>
                  <ImageParseToolButton
                    label={t('imageParseKieRemoveField', { field })}
                    disabled={disabled}
                    className="text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => {
                      editor.clearError();
                      onChange(fields.filter((item) => item !== field));
                    }}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </ImageParseToolButton>
                </>
              )}
            </li>
          ))}
        </ol>
      ) : null}

      {fields.length === 0 && !editing ? (
        <div className="flex items-start gap-2.5 py-3">
          <ListFilter className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-xs leading-5 text-muted-foreground">
            {t('imageParseKieFieldsEmptyState')}
          </p>
        </div>
      ) : null}

      {!selection.selecting ? (
        <Button
          type="button"
          variant="ghost"
          aria-pressed={editing}
          title={t(editing ? 'imageParseKieHideFieldInput' : 'imageParseKieAddField')}
          disabled={disabled || (!editing && full)}
          onClick={() => {
            editor.clearError();
            onEditingChange(!editing);
          }}
          className={cn(
            WORKSPACE_CONTROL,
            'w-fit gap-1.5 text-muted-foreground hover:text-foreground',
          )}
        >
          <Plus className={cn('size-4', editing && 'rotate-45')} aria-hidden="true" />
          {t(editing ? 'imageParseKieHideFieldInput' : 'imageParseKieAddField')}
        </Button>
      ) : null}

      {editing && !selection.selecting ? (
        <div className="animate-in fade-in-0 slide-in-from-top-1 duration-150 motion-reduce:animate-none">
          <form
            className={cn(
              'rounded-lg border bg-card p-2 transition-[border-color,box-shadow] duration-200 focus-within:ring-2 focus-within:ring-primary/10 motion-reduce:transition-none',
              error
                ? 'border-destructive/45 focus-within:border-destructive/60'
                : 'border-border/80 focus-within:border-primary/40',
            )}
            onSubmit={(event) => {
              event.preventDefault();
              submitField();
            }}
          >
            <label htmlFor={inputId} className="sr-only">
              {t('imageParseKieFieldInputLabel')}
            </label>
            <div className="flex items-end gap-2">
              <Textarea
                id={inputId}
                name="extraction-field"
                autoComplete="off"
                autoFocus
                value={draft}
                disabled={disabled}
                rows={2}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : helpId}
                placeholder={t('imageParseKieFieldPlaceholder')}
                onChange={(event) => editor.updateDraft(event.target.value)}
                onPaste={editor.paste}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    onEditingChange(false);
                    return;
                  }
                  if (event.key !== 'Enter') return;
                  if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
                    event.preventDefault();
                    return;
                  }
                  if (!event.shiftKey) {
                    event.preventDefault();
                    submitField();
                  }
                }}
                className="min-h-[64px] min-w-0 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-[13px] leading-6 shadow-none focus-visible:border-transparent focus-visible:ring-0"
              />
              <Button
                type="submit"
                disabled={disabled || full || !draft.trim()}
                className="h-10 shrink-0 gap-1.5 rounded-lg px-3 [@media(pointer:coarse)]:h-11"
              >
                <Plus className="size-3.5" aria-hidden="true" />
                {t('imageParseKieConfirmAddField')}
              </Button>
            </div>
            <p className="mt-1 border-t border-border/50 px-2 pt-1.5 text-[11px] leading-5 text-muted-foreground">
              {t('imageParseKieFieldBatchHint')}
            </p>
          </form>
          {error ? (
            <p
              id={errorId}
              role="alert"
              className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-destructive"
            >
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {t(error)}
            </p>
          ) : (
            <p id={helpId} className="mt-2 pl-1 text-[11px] leading-5 text-muted-foreground">
              {t('imageParseKieFieldsHint')}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
