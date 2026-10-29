import { useTranslation } from 'react-i18next';
import { Button } from '@map/ui';

/** 示例卡片的最小渲染契约；标准解析与 KIE 各自扩展字段。 */
export interface ImageParseExampleCard<TType extends string = string> {
  id: string;
  type: TType;
  label: string;
  thumbnail: string;
  format: 'PNG' | 'PDF';
  pages: readonly number[];
  pageCount?: number;
}

/** 示例网格组件属性。 */
export interface ImageParseExampleGridProps<TType extends string = string> {
  titleKey?: string;
  examples: readonly ImageParseExampleCard<TType>[];
  disabled?: boolean;
  onExample?: (type: TType) => void;
}

/**
 * 渲染示例文档自适应网格，桌面端 4×2，小屏逐级降列。
 * @param props 示例元数据、禁用状态和选择回调
 * @returns 示例文档网格
 */
export function ImageParseExampleGrid<TType extends string>({
  examples,
  disabled = false,
  onExample,
  titleKey = 'imageParseWorkspaceExamples',
}: ImageParseExampleGridProps<TType>) {
  const { t } = useTranslation('playground');

  function formatExamplePages(example: ImageParseExampleCard<TType>): string {
    if (example.format === 'PDF') {
      return example.pageCount !== undefined
        ? t('imageParseCasePdfPageCount', { pages: example.pageCount })
        : t('imageParseCasePdfPages', { pages: example.pages.join(', ') });
    }
    if (example.pages.length > 1) {
      return t('imageParseCaseImagePages', { pages: example.pages.length });
    }
    return example.format;
  }

  return (
    <div className="min-w-0">
      <div className="mb-3 flex min-h-11 items-center justify-between gap-3">
        <h2 className="text-xs font-medium text-muted-foreground">{t(titleKey)}</h2>
      </div>
      <div
        data-image-parse-example-grid="true"
        className="grid min-w-0 grid-cols-1 gap-3 py-1 sm:grid-cols-2 lg:grid-cols-4"
      >
        {examples.map((example) => (
          <Button
            key={example.id}
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => onExample?.(example.type)}
            aria-label={t(example.label)}
            className="group flex h-auto min-w-0 flex-col items-stretch justify-start gap-3 whitespace-normal rounded-md px-2 py-2 text-left font-normal transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed"
          >
            <span className="flex h-24 items-center justify-center overflow-hidden rounded-md bg-muted/40 p-3 sm:h-32 lg:h-36">
              <img
                src={example.thumbnail}
                alt={t(example.label)}
                loading="lazy"
                width={180}
                height={144}
                className="max-h-full max-w-full rounded-sm object-contain shadow-sm"
              />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="min-h-10 min-w-0 break-words text-sm font-medium leading-5 text-foreground sm:min-h-5">
                {t(example.label)}
              </span>
              <span className="text-[11px] font-normal leading-4 text-muted-foreground">
                {formatExamplePages(example)}
              </span>
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
}
