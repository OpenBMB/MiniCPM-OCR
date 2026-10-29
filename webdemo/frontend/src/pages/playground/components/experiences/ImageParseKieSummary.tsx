import { useMemo } from 'react';
import { MinusCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { imageParseKieRows, imageParseKieValues } from '../../utils/imageParseKie';

interface ImageParseKieSummaryProps {
  content: string;
  /** Field order submitted with the request; fields the model missed are still shown as "not found." */
  fields?: readonly string[];
}

/**
 * Expand the JSON object returned by the model into a result table by field; when it is not JSON, do not render a summary and keep only the original text.
 * @param content Raw text or Markdown draft returned by the model
 * @param fields Field list the user requested
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
