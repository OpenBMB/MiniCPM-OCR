import type { Editor } from '@tiptap/core';
import { Bold, Italic, Heading2, List, Undo2, Redo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button, cn } from '@map/ui';

import type { useImageParseRichEditor } from '../../hooks/useImageParseRichEditor';
import { WORKSPACE_CONTROL } from '../../utils/imageParseWorkspaceStyles';

interface ImageParseEditorToolbarProps {
  editor: Editor | null;
  state: ReturnType<typeof useImageParseRichEditor>['state'];
  onHistory: (redo: boolean) => void;
  onSave: () => void;
}

/** 编辑器工具栏；格式、撤销与单元格操作全部调用 Tiptap 命令。 */
export function ImageParseEditorToolbar({
  editor,
  state,
  onHistory,
  onSave,
}: ImageParseEditorToolbarProps) {
  const { t } = useTranslation('playground');
  const actions = [
    {
      label: 'imageParseEditorUndo',
      icon: Undo2,
      enabled: state?.canUndo,
      run: () => onHistory(false),
    },
    {
      label: 'imageParseEditorRedo',
      icon: Redo2,
      enabled: state?.canRedo,
      run: () => onHistory(true),
    },
    {
      label: 'imageParseEditorBold',
      icon: Bold,
      enabled: true,
      active: state?.bold,
      run: () => editor?.chain().focus().toggleBold().run(),
    },
    {
      label: 'imageParseEditorItalic',
      icon: Italic,
      enabled: true,
      active: state?.italic,
      run: () => editor?.chain().focus().toggleItalic().run(),
    },
    {
      label: 'imageParseEditorHeading',
      icon: Heading2,
      enabled: true,
      active: state?.heading,
      run: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: 'imageParseEditorList',
      icon: List,
      enabled: true,
      active: state?.list,
      run: () => editor?.chain().focus().toggleBulletList().run(),
    },
  ];
  const tableActions = [
    {
      label: 'imageParseEditorAddRow',
      enabled: true,
      run: () => editor?.chain().focus().addRowAfter().run(),
    },
    {
      label: 'imageParseEditorAddColumn',
      enabled: true,
      run: () => editor?.chain().focus().addColumnAfter().run(),
    },
    {
      label: 'imageParseEditorMerge',
      enabled: state?.canMerge,
      run: () => editor?.chain().focus().mergeCells().run(),
    },
    {
      label: 'imageParseEditorSplit',
      enabled: state?.canSplit,
      run: () => editor?.chain().focus().splitCell().run(),
    },
  ];
  return (
    <div
      role="group"
      aria-label={t('imageParseEditorTools')}
      className="flex flex-wrap items-center gap-1 border-b border-border/70 bg-muted/20 px-3 py-2"
    >
      {actions.map(({ label, icon: Icon, enabled, active, run }) => (
        <Button
          key={label}
          type="button"
          size="sm"
          variant="ghost"
          className={cn(WSPACE_ICON, active && 'bg-primary/10 text-primary')}
          disabled={!editor || !enabled}
          aria-label={t(label)}
          title={t(label)}
          aria-pressed={active}
          onClick={run}
        >
          <Icon className="size-3.5" aria-hidden="true" />
        </Button>
      ))}
      {state?.inTable
        ? tableActions.map(({ label, enabled, run }) => (
            <Button
              key={label}
              type="button"
              size="sm"
              variant="ghost"
              className={WORKSPACE_CONTROL}
              disabled={!enabled}
              onClick={run}
            >
              {t(label)}
            </Button>
          ))
        : null}
      <Button
        type="button"
        size="sm"
        className={cn(WORKSPACE_CONTROL, 'ml-auto')}
        disabled={!editor}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onSave}
      >
        {t('imageParseSaveInlineEdit')}
      </Button>
    </div>
  );
}

const WSPACE_ICON = cn(WORKSPACE_CONTROL, 'w-8 px-0');
