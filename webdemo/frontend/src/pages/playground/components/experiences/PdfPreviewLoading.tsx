import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, Skeleton, cn } from '@map/ui';

interface PdfPreviewLoadingProps {
  className?: string;
}

/**
 * PDF 预览加载占位：文档骨架与紧凑状态共用于按需加载和页面渲染。
 * @param className 外层布局样式
 */
export function PdfPreviewLoading({ className }: PdfPreviewLoadingProps) {
  const { t } = useTranslation('playground');
  return (
    <div
      role="status"
      aria-label={t('documentPdfLoading')}
      className={cn(
        'flex min-h-full w-full flex-col items-center justify-center gap-4 px-4 py-6',
        className,
      )}
    >
      <Card
        data-pdf-loading-page=""
        aria-hidden="true"
        className="aspect-[210/297] w-full max-w-56 shrink-0 select-none overflow-hidden rounded-md p-6"
      >
        <Skeleton className="mb-6 h-3 w-3/5 rounded-sm motion-reduce:animate-none" />
        <div className="space-y-3">
          <Skeleton className="h-2 w-full rounded-sm motion-reduce:animate-none" />
          <Skeleton className="h-2 w-5/6 rounded-sm motion-reduce:animate-none" />
          <Skeleton className="h-2 w-full rounded-sm motion-reduce:animate-none" />
          <Skeleton className="h-2 w-2/3 rounded-sm motion-reduce:animate-none" />
        </div>
        <Skeleton className="my-6 h-16 w-full rounded-sm motion-reduce:animate-none" />
        <div className="space-y-3">
          <Skeleton className="h-2 w-full rounded-sm motion-reduce:animate-none" />
          <Skeleton className="h-2 w-4/5 rounded-sm motion-reduce:animate-none" />
        </div>
      </Card>
      <p className="flex max-w-full items-center justify-center gap-2 text-center text-xs leading-5 text-muted-foreground">
        <Loader2
          className="size-3.5 shrink-0 animate-spin text-primary motion-reduce:animate-none"
          aria-hidden="true"
        />
        {t('documentPdfLoading')}
      </p>
    </div>
  );
}
