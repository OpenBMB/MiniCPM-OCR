import { useMemo } from 'react';
import { MinusCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { imageParseKieRows, imageParseKieValues } from '../../utils/imageParseKie';

interface ImageParseKieSummaryProps {
  content: string;
  /** 请求时提交的字段顺序；模型漏掉的字段也会以“未找到”展示。 */
  fields?: readonly string[];
}

/**
 * 将模型返回的 JSON 对象按字段展开为结果表；非 JSON 时不渲染摘要，仅保留原文展示。
 * @param content 模型返回的原始文本或 Markdown 草稿
 * @param fields 用户请求的字段列表
 */
export function ImageParseKieSummary({ content, fields = [] }: ImageParseKieSummaryProps) {
  const { t } = useTranslation('playground');
  const values = useMemo(() => imageParseKieValues(content), [content]);
  const rows = useMemo(() => imageParseKieRows(values, fields), [fields, values]);

  if (!values) {
    return null;
  }

  return (
    <section aria-label={t('imageParseKieResult')} className="mb-5 min-w-0 bg-card">
      <dl className="divide-y divide-border/50">
        {rows.map((row) => (
          <div
            key={row.field}
            className="grid gap-1 py-3 transition-colors hover:bg-muted/20 sm:grid-cols-[minmax(6rem,10rem)_minmax(0,1fr)] sm:gap-4"
          >
            <dt className="min-w-0 break-words text-xs font-medium text-muted-foreground">
              {row.field}
            </dt>
            <dd className="min-w-0">
              {row.missing ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/80">
                  <MinusCircle className="size-3.5" aria-hidden="true" />
                  {t('imageParseKieMissing')}
                </span>
              ) : (
                <span className="block whitespace-pre-wrap break-words text-sm text-foreground">
                  {row.value}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
