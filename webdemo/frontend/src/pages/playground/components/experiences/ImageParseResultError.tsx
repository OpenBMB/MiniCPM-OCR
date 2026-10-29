import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@map/ui';

interface ImageParseResultErrorProps {
  message?: string;
  disabled: boolean;
  onRetry: () => void;
}

/**
 * Recognition error and the only retry entry; a single-page PDF error is still owned by the matching result page.
 * @param props Visible error, retry state, and callbacks
 * @returns A recoverable inline error bar
 */
export function ImageParseResultError({ message, disabled, onRetry }: ImageParseResultErrorProps) {
  const { t } = useTranslation('playground');
  if (!message) return null;
  return (
    <div
      role="alert"
      className="m-4 flex shrink-0 flex-wrap items-start justify-between gap-3 rounded-md bg-destructive/10 px-3 py-3 text-sm text-destructive"
    >
      <span className="min-w-0 flex-1 break-words">{message}</span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 shrink-0 gap-1.5 [@media(pointer:coarse)]:h-11"
        disabled={disabled}
        onClick={onRetry}
      >
        <RefreshCw className="size-3.5" aria-hidden="true" />
        {t('imageParseRetry')}
      </Button>
    </div>
  );
}
