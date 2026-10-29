import { EditorContent, ReactNodeViewRenderer } from '@tiptap/react';
import { useTranslation } from 'react-i18next';

import type { ImageParseBlockController } from '../../hooks/useImageParseVisualEditor';
import { useImageParseRichEditor } from '../../hooks/useImageParseRichEditor';
import {
  imageParseEditorExtensions,
  PreservedImageParseSource,
} from '../../utils/imageParseEditorExtensions';
import { IMAGE_PARSE_RICH_EDITOR_CLASS } from '../../utils/imageParseEditorStyles';
import {
  ImageParseFormulaEditContext,
  type ImageParseFormulaTarget,
} from '../../utils/imageParseFormulaEditContext';
import { ImageParsePreservedSource } from './ImageParsePreservedSource';
import { ImageParseEditorToolbar } from './ImageParseEditorToolbar';
import { ImageParseMathNodeView } from './ImageParseMathNodeView';

const EXTENSIONS = imageParseEditorExtensions(
  PreservedImageParseSource.extend({
    addNodeView() {
      return ReactNodeViewRenderer(ImageParsePreservedSource);
    },
  }),
  ReactNodeViewRenderer(ImageParseMathNodeView),
);

interface ImageParseRichEditorProps {
  source: string;
  onSave: (value: string) => void;
  definitions: string;
  register: (controller: ImageParseBlockController) => void;
  initialMath: ImageParseFormulaTarget | null;
  onCommit: () => void;
}

/** Tiptap 文档编辑视图：正文、表格和撤销共用成熟编辑器的事务模型。 */
export function ImageParseRichEditor({
  source,
  onSave,
  definitions,
  register,
  initialMath,
  onCommit,
}: ImageParseRichEditorProps) {
  const { t } = useTranslation('playground');
  const rich = useImageParseRichEditor(
    source,
    EXTENSIONS,
    t('imageParseInlineEditor'),
    definitions,
    onSave,
    register,
    initialMath,
  );
  return (
    <div className="overflow-hidden rounded-lg border border-primary/35 bg-card shadow-sm">
      <ImageParseEditorToolbar
        editor={rich.editor}
        state={rich.state}
        onHistory={rich.history}
        onSave={onCommit}
      />
      <ImageParseFormulaEditContext.Provider value={rich.formulaContext}>
        <EditorContent
          editor={rich.editor}
          className={IMAGE_PARSE_RICH_EDITOR_CLASS}
          aria-label={t('imageParseInlineEditor')}
        />
      </ImageParseFormulaEditContext.Provider>
      {rich.error ? (
        <p role="alert" className="px-4 py-2 text-xs text-destructive">
          {t('imageParseEditorSaveError')}
        </p>
      ) : null}
    </div>
  );
}
