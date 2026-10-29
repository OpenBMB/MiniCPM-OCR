import { useRef } from 'react';
import { FileImage, FolderOpen, Play, ScanText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, cn } from '@map/ui';

import { PIPELINE_IMAGE_TYPES } from '../../utils/documentUpload';
import { WORKSPACE_TOOLBAR } from '../../utils/imageParseWorkspaceStyles';

interface ImageParseReadyPaneProps {
  unsupported?: boolean;
  canStart: boolean;
  blockedReason?: string;
  onStart: () => void;
  onDocumentMode: () => void;
  onReplace: (file: File) => void;
}

/**
 * Action area after upload finishes but before the model is called; PDF field extraction provides a clear resume action.
 * @param props File capabilities, start-recognition, and task-resume entries
 * @returns The pending panel for the current file
 */
export function ImageParseReadyPane({
  unsupported = false,
  canStart,
  blockedReason,
  onStart,
  onDocumentMode,
  onReplace,
}: ImageParseReadyPaneProps) {
  const { t } = useTranslation('playground');
  const replaceInput = useRef<HTMLInputElement>(null);
  return (
    <section className="flex h-full min-h-64 flex-col bg-card">
      <div className={cn(WORKSPACE_TOOLBAR, 'py-1 text-xs font-medium')}>
        {t(unsupported ? 'imageParseTaskKie' : 'imageParseRecognitionResult')}
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 py-10 text-center">
        {unsupported ? (
          <FileImage className="size-8 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ScanText className="size-8 text-muted-foreground" aria-hidden="true" />
        )}
        <h2 className="text-base font-semibold">
          {t(unsupported ? 'imageParseSealPdfTitle' : 'imageParseReadyTitle')}
        </h2>
        <p className="max-w-sm text-sm leading-6 text-muted-foreground" role="status">
          {t(unsupported ? 'imageParseSealPdfDescription' : 'imageParseReadyDescription')}
        </p>
        {unsupported ? (
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" className="min-h-11" onClick={onDocumentMode}>
              <ScanText className="mr-1.5 size-4" aria-hidden="true" />
              {t('imageParseBackToDocument')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => replaceInput.current?.click()}
            >
              <FolderOpen className="mr-1.5 size-4" aria-hidden="true" />
              {t('imageParseReplaceImage')}
            </Button>
            <input
              ref={replaceInput}
              type="file"
              accept={PIPELINE_IMAGE_TYPES.join(',')}
              tabIndex={-1}
              aria-label={t('imageParseReplaceImage')}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onReplace(file);
                event.target.value = '';
              }}
            />
          </div>
        ) : (
          <Button type="button" disabled={!canStart} onClick={onStart} className="min-h-11 gap-2">
            <Play className="size-4" aria-hidden="true" />
            {t('imageParseStart')}
          </Button>
        )}
        {!unsupported && blockedReason ? (
          <p className="text-xs text-destructive">{t(blockedReason)}</p>
        ) : null}
      </div>
    </section>
  );
}
