import { useRef, useState } from 'react';
import { ArrowLeft, ScanText, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  cn,
} from '@map/ui';

import { MAX_IMAGE_PARSE_KIE_FIELDS } from '../../utils/imageParseKie';
import { WORKSPACE_CONTROL, WORKSPACE_TOOLBAR } from '../../utils/imageParseWorkspaceStyles';
import { useImageParseKieFieldEditor } from '../../hooks/useImageParseKieFieldEditor';
import { useImageParseKieFieldSelection } from '../../hooks/useImageParseKieFieldSelection';
import { ImageParseKieFields } from './ImageParseKieFields';
import { ImageParseToolButton } from './ImageParseToolButton';

interface ImageParseKieSetupPaneProps {
  fields: readonly string[];
  onChange: (fields: string[]) => void;
  onStart: (fields: string[]) => void;
  onBack?: () => void;
  disabled?: boolean;
  canStart: boolean;
  blockedReason?: string;
}

/**
 * 信息抽取的字段配置面板。配置阶段复用结果栏空间，左侧保留原图，
 * 让用户能一边查看图片一边决定需要抽取的信息。
 * @param props 字段状态、开始/返回回调与禁用原因
 * @returns 右侧字段配置工作区
 */
export function ImageParseKieSetupPane({
  fields,
  onChange,
  onStart,
  onBack,
  disabled = false,
  canStart,
  blockedReason,
}: ImageParseKieSetupPaneProps) {
  const { t } = useTranslation('playground');
  const editor = useImageParseKieFieldEditor(fields, onChange);
  const selection = useImageParseKieFieldSelection(fields, onChange, disabled);
  const selectionButtonRef = useRef<HTMLButtonElement>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const reason = editor.error ?? editor.submissionError ?? blockedReason;
  const ready = canStart && !editor.submissionError;
  const [editingField, setEditingField] = useState(false);
  return (
    <section className="flex h-full min-h-0 flex-col bg-card">
      <header
        data-kie-toolbar=""
        data-tour="image-parse-kie-fields"
        className={cn(WORKSPACE_TOOLBAR, 'gap-x-2 py-1 text-xs')}
      >
        <h2 className="font-medium text-foreground">{t('imageParseKieSetupTitle')}</h2>
        <span
          className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground"
          aria-live="polite"
        >
          {fields.length} / {MAX_IMAGE_PARSE_KIE_FIELDS}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            ref={selectionButtonRef}
            type="button"
            variant="ghost"
            aria-label={t(
              selection.selecting ? 'imageParseKieCancelSelection' : 'imageParseKieBatchDelete',
            )}
            aria-pressed={selection.selecting}
            title={t(
              selection.selecting ? 'imageParseKieCancelSelection' : 'imageParseKieBatchDelete',
            )}
            disabled={disabled || (!selection.selecting && fields.length === 0)}
            onClick={() => {
              editor.clearError();
              setEditingField(false);
              selection.toggleMode();
            }}
            className={cn(
              WORKSPACE_CONTROL,
              'gap-1.5 text-muted-foreground hover:text-foreground',
              selection.selecting && 'bg-accent text-foreground',
            )}
          >
            {selection.selecting ? (
              <X className="size-4" aria-hidden="true" />
            ) : (
              <Trash2 className="size-4" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">
              {t(selection.selecting ? 'imageParseKieCancelSelection' : 'imageParseKieBatchDelete')}
            </span>
          </Button>
          {onBack ? (
            <ImageParseToolButton label={t('imageParseKieBackToResult')} onClick={onBack}>
              <ArrowLeft className="size-4" aria-hidden="true" />
            </ImageParseToolButton>
          ) : null}
        </div>
      </header>
      <div className="min-h-0 flex-1 overscroll-contain px-4 py-5 sm:px-6 lg:overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl">
          <ImageParseKieFields
            fields={fields}
            onChange={onChange}
            editor={editor}
            selection={selection}
            editing={editingField}
            onEditingChange={setEditingField}
            disabled={disabled}
          />
        </div>
      </div>
      <footer className="sticky bottom-0 shrink-0 border-t border-border/60 bg-card px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-end gap-3">
          {reason ? (
            <p className="mr-auto text-xs leading-5 text-muted-foreground">{t(reason)}</p>
          ) : null}
          <Button
            type="button"
            data-tour="image-parse-kie-start"
            disabled={disabled || !ready}
            title={reason ? t(reason) : undefined}
            onClick={() => onStart(editor.submissionFields)}
            className="h-11 w-full shrink-0 gap-2 rounded-xl px-5 shadow-sm shadow-primary/20 transition-[background-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:bg-primary/95 hover:shadow-md active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none sm:w-auto"
          >
            <ScanText className="size-4" aria-hidden="true" />
            {t('imageParseStartKie')}
          </Button>
        </div>
      </footer>
      <Dialog open={selection.confirming} onOpenChange={selection.setConfirming}>
        <DialogContent
          onClose={() => selection.setConfirming(false)}
          closeLabel={t('imageParseKieCloseDelete')}
          className="rounded-t-lg sm:rounded-lg"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancelDeleteRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            selectionButtonRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('imageParseKieDeleteFieldsTitle')}</DialogTitle>
            <DialogDescription>
              {t('imageParseKieDeleteFieldsDescription', { count: selection.pendingCount })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              ref={cancelDeleteRef}
              variant="outline"
              onClick={() => selection.setConfirming(false)}
              className="min-h-11 sm:min-h-8"
            >
              {t('imageParseKieCancelDelete')}
            </Button>
            <Button
              variant="destructive"
              disabled={disabled || selection.pendingCount === 0}
              onClick={() => {
                editor.clearError();
                selection.confirmDelete();
              }}
              className="min-h-11 gap-2 sm:min-h-8"
            >
              <Trash2 className="size-4" aria-hidden="true" />
              {t('imageParseKieConfirmDelete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
