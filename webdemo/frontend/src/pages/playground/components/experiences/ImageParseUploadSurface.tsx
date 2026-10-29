import { useRef, type ChangeEvent, type DragEventHandler } from 'react';
import { Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, cn } from '@map/ui';
import { DOCUMENT_ACCEPT } from '../../utils/documentUpload';

interface ImageParseUploadSurfaceProps {
  disabled?: boolean;
  previewOnly?: boolean;
  dragging?: boolean;
  accept?: string;
  multiple?: boolean;
  hintKey?: string;
  actionKey?: string;
  onOpen: () => void;
  onFiles?: (files: FileList) => void;
  onDragOver?: DragEventHandler<HTMLButtonElement>;
  onDragLeave?: DragEventHandler<HTMLButtonElement>;
  onDrop?: DragEventHandler<HTMLButtonElement>;
}

/**
 * Dashed frame and the limit notes outside it. Clicking the dashed frame opens the same file picker; both images and PDFs are chosen from here.
 * @param props File-selection callback, drag-and-drop events, and disabled state
 * @returns Upload surface shared by the workspace and the upload page
 */
export function ImageParseUploadSurface({
  disabled,
  previewOnly = false,
  dragging = false,
  accept = DOCUMENT_ACCEPT,
  multiple = true,
  hintKey = 'imageParseUploadHint',
  actionKey = 'imageParseUploadAction',
  onOpen,
  onFiles,
  onDragOver,
  onDragLeave,
  onDrop,
}: ImageParseUploadSurfaceProps) {
  const { t } = useTranslation('playground');
  const fileInput = useRef<HTMLInputElement>(null);
  const takeFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!disabled && files?.length) onFiles?.(files);
    event.target.value = '';
  };
  return (
    <div className="flex w-full flex-col gap-6" data-tour="image-parse-upload">
      <div className="relative">
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          aria-label={t(actionKey)}
          onClick={onFiles ? () => fileInput.current?.click() : onOpen}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={cn(
            'flex h-auto min-h-44 w-full flex-col items-center justify-center gap-3 whitespace-normal rounded-lg border border-dashed border-primary/35 bg-card px-6 py-8 text-center shadow-sm sm:min-h-52',
            'transition-[border-color,background-color] duration-200 ease-out',
            'hover:border-primary hover:bg-primary/[0.03]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'motion-reduce:transition-none',
            dragging && 'border-primary bg-primary/[0.03]',
            disabled && 'cursor-not-allowed opacity-60',
          )}
        >
          <span className="mb-1 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Upload className="size-6" aria-hidden="true" />
          </span>
          <span className="text-sm text-foreground sm:text-base">
            {t('imageParseUploadLead')}
            <span className="font-medium text-primary">{t('imageParseUploadLink')}</span>
          </span>
          <span className="text-xs text-muted-foreground">{t(hintKey)}</span>
        </Button>
        {onFiles ? (
          <input
            ref={fileInput}
            type="file"
            accept={accept}
            multiple={multiple}
            disabled={disabled}
            aria-label={t(actionKey)}
            className="hidden"
            onChange={takeFiles}
            onDragOver={onDragOver as DragEventHandler<HTMLInputElement> | undefined}
            onDragLeave={onDragLeave as DragEventHandler<HTMLInputElement> | undefined}
            onDrop={onDrop as DragEventHandler<HTMLInputElement> | undefined}
          />
        ) : null}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span>{t(multiple ? 'imageParseLimitSize' : 'imageParseLimitSingleImage')}</span>
        <span>{t('imageParseLimitPaste')}</span>
        {previewOnly ? <span>{t('imageParseLimitPreview')}</span> : null}
      </div>
    </div>
  );
}
