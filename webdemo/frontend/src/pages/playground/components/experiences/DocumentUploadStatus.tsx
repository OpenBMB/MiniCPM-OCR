import { FileImage, FileText, Loader2, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardContent, cn } from '@map/ui';
import type { useDocumentUpload } from '../../hooks/useDocumentUpload';
import { formatBytes } from '../../utils/attachments';

interface DocumentUploadStatusProps {
  upload: ReturnType<typeof useDocumentUpload>;
  /** When a document already exists, keep the preview and place input-validation errors above the content. */
  inline?: boolean;
}

/** In the upload area, show the file and the real waiting state. On failure the original file can be retried; do not fake progress. */
export function DocumentUploadStatus({ upload, inline }: DocumentUploadStatusProps) {
  const { t } = useTranslation('playground');
  if (!upload.pending && !upload.error) return null;
  const image = upload.file?.type.startsWith('image/');
  const FileIcon = image ? FileImage : FileText;
  const hint = upload.error ? 'documentUploadRetryHint' : 'documentUploadWaitHint';
  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 items-center justify-center overflow-auto bg-background px-4 py-8 sm:px-6',
        inline && 'flex-none py-3',
      )}
    >
      <Card className="my-auto w-full max-w-xl rounded-xl shadow-sm">
        <CardContent className="space-y-5 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileIcon className="size-6" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground" title={upload.file?.name}>
                {upload.file?.name || t('imageParseUploadTitle')}
              </p>
              {upload.file ? (
                <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                  {formatBytes(upload.file.size)}
                </p>
              ) : null}
            </div>
          </div>
          <div
            role={upload.error ? 'alert' : 'status'}
            className={cn(
              'flex items-start gap-2.5 rounded-lg bg-muted/50 px-3 py-3',
              upload.error && 'bg-destructive/5',
            )}
          >
            {upload.pending ? (
              <Loader2
                className="mt-0.5 size-4 shrink-0 animate-spin text-primary motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <TriangleAlert
                className="mt-0.5 size-4 shrink-0 text-destructive"
                aria-hidden="true"
              />
            )}
            <div className="min-w-0">
              <p
                className={cn(
                  'text-sm font-medium text-foreground',
                  upload.error && 'text-destructive',
                )}
              >
                {upload.error || t('documentUploading')}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{t(hint)}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={upload.cancel}>
              {t(upload.pending ? 'documentCancelUpload' : 'documentDismiss')}
            </Button>
            {upload.error && upload.file ? (
              <Button type="button" className="min-h-11" onClick={upload.retry}>
                {t('documentRetryUpload')}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
