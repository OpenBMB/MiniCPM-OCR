import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useTranslation } from 'react-i18next';

import { MarkdownRenderer } from '../MarkdownRenderer';

/**
 * Show an original document block that cannot be converted reliably; keep it read-only so it is not lost when other content is saved.
 * @param node Schema node that contains only the original source
 */
export function ImageParsePreservedSource({ node }: NodeViewProps) {
  const { t } = useTranslation('playground');
  return (
    <NodeViewWrapper
      className="my-3 rounded-lg border border-border bg-muted/15 p-3"
      contentEditable={false}
    >
      <p className="mb-2 text-xs text-muted-foreground">{t('imageParseEditorPreserved')}</p>
      <MarkdownRenderer content={String(node.attrs.source ?? '')} variant="document" />
    </NodeViewWrapper>
  );
}
