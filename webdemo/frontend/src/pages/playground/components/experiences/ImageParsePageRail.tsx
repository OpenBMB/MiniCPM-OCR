import { useRef, type ReactNode } from 'react';
import { LoaderCircle, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, cn } from '@map/ui';

import { DOCUMENT_ACCEPT } from '../../utils/documentUpload';

/** 原件页导航项；预览由图片或 PDF 阅读器提供。 */
export interface ImageParsePageItem {
  pageNumber: number;
  preview: ReactNode;
}

interface ImageParsePageRailProps {
  pages: readonly ImageParsePageItem[];
  page: number;
  onPageChange?: (page: number) => void;
  onAppendPages?: (files: FileList) => void;
  disabled?: boolean;
  appending?: boolean;
}

/**
 * 原件页面缩略图列表；桌面纵向排列，窄屏使用独立滚动的横向页带。
 * @param props 页面预览、当前页及切页和追加回调
 * @returns 页面导航与列表末尾的添加入口
 */
export function ImageParsePageRail({
  pages,
  page,
  onPageChange,
  onAppendPages,
  disabled,
  appending = false,
}: ImageParsePageRailProps) {
  const { t } = useTranslation('playground');
  const input = useRef<HTMLInputElement>(null);
  return (
    <nav
      aria-label={t('imageParsePages')}
      data-page-rail=""
      className="flex max-h-32 min-h-0 min-w-0 shrink-0 flex-col border-b border-border/60 bg-card lg:max-h-none lg:w-24 lg:border-b-0 lg:border-r"
    >
      <p className="hidden shrink-0 px-2 pb-1 pt-3 text-center text-xs text-muted-foreground lg:block">
        {t('imageParsePageCount', { count: pages.length })}
      </p>
      <div className="flex min-h-0 gap-2 overflow-auto overscroll-contain p-2 lg:flex-1 lg:flex-col lg:items-center lg:py-3">
        {pages.map(({ pageNumber, preview }) => (
          <Button
            key={pageNumber}
            type="button"
            variant="ghost"
            aria-label={t('imageParseGoToPage', { page: pageNumber })}
            aria-current={pageNumber === page ? 'page' : undefined}
            className={cn(
              'h-auto w-14 shrink-0 flex-col gap-1 rounded-md border border-transparent p-1 lg:w-[72px]',
              pageNumber === page
                ? 'border-primary/50 bg-primary/5 text-primary'
                : 'text-muted-foreground hover:bg-muted/50',
            )}
            onClick={() => onPageChange?.(pageNumber)}
          >
            <span className="flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-sm border border-border/60 bg-background [&>img]:size-full [&>img]:object-contain">
              {preview}
            </span>
            <span className="text-xs leading-4 tabular-nums">{pageNumber}</span>
          </Button>
        ))}
        {onAppendPages ? (
          <>
            <Button
              type="button"
              variant="ghost"
              aria-label={t(appending ? 'imageParseAddingPages' : 'imageParseAddPages')}
              title={t('imageParseAddPages')}
              disabled={disabled || appending}
              className="h-auto w-14 shrink-0 flex-col gap-1 rounded-md border border-transparent p-1 text-muted-foreground lg:w-[72px]"
              onClick={() => input.current?.click()}
            >
              <span className="flex aspect-[3/4] w-full items-center justify-center rounded-sm border border-dashed border-border bg-muted/20">
                {appending ? (
                  <LoaderCircle
                    className="size-5 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : (
                  <Plus className="size-5" aria-hidden="true" />
                )}
              </span>
              <span aria-hidden="true" className="text-xs leading-4">
                {t('imageParseAddPageShort')}
              </span>
            </Button>
            <input
              ref={input}
              type="file"
              multiple
              accept={DOCUMENT_ACCEPT}
              aria-label={t('imageParseAddPages')}
              tabIndex={-1}
              hidden
              disabled={disabled || appending}
              onChange={(event) => {
                const files = event.target.files;
                if (files?.length) onAppendPages(files);
                event.target.value = '';
              }}
            />
          </>
        ) : null}
      </div>
      {appending ? (
        <span role="status" className="sr-only">
          {t('imageParseAddingPages')}
        </span>
      ) : null}
    </nav>
  );
}
