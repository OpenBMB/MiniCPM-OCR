import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, PencilLine } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { copyText } from '../../utils/copyText';
import { imageParseKieRows, imageParseKieValues } from '../../utils/imageParseKie';
import { ImageParseToolButton } from './ImageParseToolButton';

interface ImageParseKieResultCommandsProps {
  content: string;
  fields: readonly string[];
  disabled?: boolean;
  onEditFields?: () => void;
}

/**
 * 集中展示字段命中统计、修改字段与 JSON 复制，供结果工具栏及失败状态复用。
 * @param props 当前结果、请求字段与编辑入口
 * @returns 随窄栏换行的统计和图标操作
 */
export function ImageParseKieResultCommands({
  content,
  fields,
  disabled,
  onEditFields,
}: ImageParseKieResultCommandsProps) {
  const { t } = useTranslation('playground');
  const [copied, setCopied] = useState(false);
  const values = useMemo(() => imageParseKieValues(content), [content]);
  const rows = useMemo(() => imageParseKieRows(values, fields), [values, fields]);
  const found = rows.filter((row) => !row.missing).length;
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied, content]);

  async function copyJson() {
    if (!values) return;
    if (await copyText(JSON.stringify(values, null, 2))) setCopied(true);
  }

  return (
    <div
      data-kie-result-commands=""
      className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-x-2 gap-y-1"
    >
      {values ? (
        <span className="text-[11px] tabular-nums text-muted-foreground" aria-live="polite">
          {t('imageParseKieResultCount', { found, total: rows.length })}
        </span>
      ) : null}
      <div className="flex shrink-0 items-center gap-0.5">
        {onEditFields ? (
          <ImageParseToolButton
            label={t('imageParseKieModifyFields')}
            disabled={disabled}
            onClick={onEditFields}
          >
            <PencilLine className="size-4" aria-hidden="true" />
          </ImageParseToolButton>
        ) : null}
        {values ? (
          <ImageParseToolButton
            label={t(copied ? 'imageParseKieCopied' : 'imageParseKieCopy')}
            disabled={disabled}
            onClick={() => void copyJson()}
          >
            {copied ? (
              <Check className="size-4 text-primary" aria-hidden="true" />
            ) : (
              <Copy className="size-4" aria-hidden="true" />
            )}
          </ImageParseToolButton>
        ) : null}
      </div>
    </div>
  );
}
