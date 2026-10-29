import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@map/ui';

interface ImageParseResultErrorProps {
  message?: string;
  disabled: boolean;
  onRetry: () => void;
}

/**
 * 识别错误与唯一重试入口；PDF 单页错误仍由相应结果页负责。
 * @param props 可见错误、重试状态及回调
 * @returns 可恢复的内联错误条
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
