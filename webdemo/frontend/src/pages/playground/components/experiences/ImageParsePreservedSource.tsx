import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useTranslation } from 'react-i18next';

import { MarkdownRenderer } from '../MarkdownRenderer';

/**
 * 展示无法可靠转换的原始文档块；只读保留，避免保存其它内容时丢失。
 * @param node 仅含原始源码的 schema 节点
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
