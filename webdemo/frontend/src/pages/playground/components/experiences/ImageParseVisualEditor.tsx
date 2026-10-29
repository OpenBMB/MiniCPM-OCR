import { lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@map/ui';

import type { ImageParseTextRange } from '../../utils/imageParseBlocks';
import { useImageParseVisualEditor } from '../../hooks/useImageParseVisualEditor';
import { ImageParseBlockEditContext } from '../../utils/imageParseBlockEditContext';
import { imageParseReferenceDefinitions } from '../../utils/imageParseDocumentBlocks';
import { imageParseRangeKey, isImageParsePageNumber } from '../../utils/imageParsePageNumber';
import {
  imageParseFormulaTarget,
  type ImageParseFormulaTarget,
} from '../../utils/imageParseFormulaEditContext';
import { lazyWithRetry } from '@/utils/lazyWithRetry';

const RichEditor = lazy(() =>
  lazyWithRetry(() =>
    import('./ImageParseRichEditor').then((module) => ({ default: module.ImageParseRichEditor })),
  ),
);

interface ImageParseVisualEditorProps {
  source: string;
  loading: boolean;
  onSave: (value: string, editedRange?: ImageParseTextRange) => void;
  onEditingChange?: (editing: boolean) => void;
  /** 服务标记为页脚 / 页码的块范围；只在文字仍像页码时弱化展示。 */
  pageNumberRanges?: ReadonlySet<string>;
  children: React.ReactNode;
}

/** 双击语义块才创建编辑器；其它块保留预览，失焦保存并释放唯一实例。 */
export function ImageParseVisualEditor({
  source,
  loading,
  onSave,
  onEditingChange,
  pageNumberRanges,
  children,
}: ImageParseVisualEditorProps) {
  const { t } = useTranslation('playground');
  const {
    root,
    active: activeRange,
    begin,
    finish,
    saveBlock,
    register,
  } = useImageParseVisualEditor(source, onSave);
  const editing = Boolean(activeRange);
  useEffect(() => {
    onEditingChange?.(editing);
    return () => onEditingChange?.(false);
  }, [editing, onEditingChange]);
  const definitions = useMemo(() => imageParseReferenceDefinitions(source), [source]);
  const initialMath = useRef<ImageParseFormulaTarget | null>(null);
  const context = useMemo(
    () => ({
      renderBlock: (range: ImageParseTextRange, preview: React.ReactNode) => {
        const active =
          !loading && activeRange?.start === range.start && activeRange.end === range.end;
        const pageNumber =
          !active &&
          Boolean(pageNumberRanges?.has(imageParseRangeKey(range))) &&
          isImageParsePageNumber(source.slice(range.start, range.end));
        return (
          <div
            data-edit-block={range.start}
            data-page-number={pageNumber ? 'true' : undefined}
            data-visual-editing={active}
            tabIndex={loading || active ? undefined : 0}
            className={cn(
              'rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
              pageNumber &&
                'flex justify-end [&_p]:my-0 [&_p]:text-[11px] [&_p]:font-medium [&_p]:leading-5 [&_p]:tabular-nums [&_p]:text-muted-foreground/80',
            )}
            onDoubleClick={(event) => {
              if (loading || active) return;
              event.preventDefault();
              event.stopPropagation();
              initialMath.current = imageParseFormulaTarget(event.target, event.currentTarget);
              begin(range);
            }}
            onKeyDown={(event) => {
              if (
                !active &&
                !loading &&
                event.key === 'Enter' &&
                event.target === event.currentTarget
              ) {
                event.preventDefault();
                initialMath.current = null;
                begin(range);
              }
              if (active && event.key === 'Escape' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                finish(false);
              }
            }}
          >
            {active ? (
              <Suspense
                fallback={
                  <p role="status" className="py-4 text-sm text-muted-foreground">
                    {t('imageParseEditorLoading')}
                  </p>
                }
              >
                <RichEditor
                  key={`${range.start}:${range.end}`}
                  source={source.slice(range.start, range.end)}
                  definitions={definitions}
                  onSave={saveBlock}
                  register={register}
                  initialMath={initialMath.current}
                  onCommit={() => finish(true)}
                />
              </Suspense>
            ) : (
              preview
            )}
          </div>
        );
      },
    }),
    [
      loading,
      activeRange,
      begin,
      finish,
      t,
      source,
      definitions,
      saveBlock,
      register,
      pageNumberRanges,
    ],
  );
  return (
    <div ref={root}>
      <ImageParseBlockEditContext.Provider value={context}>
        {children}
      </ImageParseBlockEditContext.Provider>
    </div>
  );
}
