import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/core';
import type { KeyboardEvent, MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@map/ui';

import { useImageParseFormulaNode } from '../../hooks/useImageParseFormulaNode';
import { ImageParseFormulaSource } from './ImageParseFormulaSource';

/** Formulas stay as copyable KaTeX DOM; the input replaces the current node directly, with no image or separate edit panel. */
export function ImageParseMathNodeView(props: NodeViewProps) {
  const { t } = useTranslation('playground');
  const formula = useImageParseFormulaNode(props);
  const preview =
    formula.preview === null ? (
      formula.latex
    ) : (
      <span dangerouslySetInnerHTML={{ __html: formula.preview }} />
    );
  return (
    <NodeViewWrapper
      as={formula.display ? 'div' : 'span'}
      className={cn(
        'tiptap-mathematics-render align-middle focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
        formula.editing && !formula.display && 'w-64',
      )}
      data-type={formula.display ? 'block-math' : 'inline-math'}
      data-latex={formula.latex}
      data-formula-editing={formula.editing}
      contentEditable={false}
      tabIndex={formula.editing ? undefined : 0}
      role={formula.editing ? undefined : 'button'}
      aria-label={formula.editing ? undefined : t('imageParseFormulaSource')}
      onDoubleClick={(event: MouseEvent) => {
        if (formula.editing) return;
        event.preventDefault();
        event.stopPropagation();
        formula.begin();
      }}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        formula.begin();
      }}
    >
      {formula.editing ? (
        <ImageParseFormulaSource
          latex={formula.latex}
          display={formula.display}
          onChange={formula.change}
          onBlur={formula.blur}
          onHistory={formula.history}
          onComposing={formula.onComposing}
        />
      ) : (
        preview
      )}
    </NodeViewWrapper>
  );
}
