import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from '@map/ui';

import { DOCUMENT_ACCEPT } from '../../utils/documentUpload';

interface ImageParseUploadDialogProps {
  open: boolean;
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (file: File) => void;
}

/** 新建识别弹窗，复用工作台的上传校验和解析生命周期。 */
export function ImageParseUploadDialog({
  open,
  disabled,
  onOpenChange,
  onPick,
}: ImageParseUploadDialogProps) {
  const { t } = useTranslation('playground');
  const input = useRef<HTMLInputElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onClose={() => onOpenChange(false)}
        closeLabel={t('documentDismiss')}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{t('imageParseNewDocument')}</DialogTitle>
        </DialogHeader>
        <input
          ref={input}
          type="file"
          accept={DOCUMENT_ACCEPT}
          className="sr-only"
          aria-label={t('imageParseUploadAction')}
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file && event.target.files?.length === 1) {
              onOpenChange(false);
              onPick(file);
            }
            event.target.value = '';
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => input.current?.click()}
          className="flex h-40 w-full flex-col gap-3 rounded-lg border-dashed"
        >
          <Upload className="size-7 text-primary" aria-hidden="true" />
          {t('imageParseUploadAction')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('imageParseUploadHint')}</p>
      </DialogContent>
    </Dialog>
  );
}
