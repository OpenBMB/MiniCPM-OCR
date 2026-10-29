import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { NodeViewProps } from '@tiptap/core';
import katex from 'katex';

import { ImageParseFormulaEditContext } from '../utils/imageParseFormulaEditContext';
import { isSupportedKatex } from '../utils/math-katex';
import { SAFE_KATEX_OPTIONS } from '../utils/math-options';

/** 管理公式原位输入和节点事务；只有显式双击或键盘操作才从展示切换到输入。 */
export function useImageParseFormulaNode({
  editor,
  node,
  getPos,
  updateAttributes,
}: NodeViewProps) {
  const context = useContext(ImageParseFormulaEditContext);
  const latex = String(node.attrs.latex ?? '');
  const display = node.type.name === 'blockMath';
  const composing = useRef(false);
  const pendingBlur = useRef(false);
  const original = useRef(latex);
  const [editing, setEditing] = useState(() => {
    const target = context?.initial;
    if (!target) return display && editor.state.doc.childCount === 1;
    if (target.latex !== latex) return false;
    let occurrence = 0;
    let match = false;
    const position = getPos();
    editor.state.doc.descendants((item, pos) => {
      if (
        !['inlineMath', 'blockMath'].includes(item.type.name) ||
        item.attrs.latex !== target.latex
      )
        return;
      if (pos === position && occurrence === target.occurrence) match = true;
      occurrence += 1;
    });
    return match;
  });
  const preview = useMemo(() => {
    try {
      return katex.renderToString(latex, { ...SAFE_KATEX_OPTIONS, displayMode: display });
    } catch {
      return null;
    }
  }, [latex, display]);
  const invalid = !latex.trim() || !isSupportedKatex(latex);

  function begin() {
    const position = getPos();
    if (!editor.isEditable || position === undefined) return;
    original.current = latex;
    editor.commands.setNodeSelection(position);
    setEditing(true);
  }
  function blur() {
    if (composing.current) {
      pendingBlur.current = true;
      return;
    }
    if (invalid && latex !== original.current) return;
    pendingBlur.current = false;
    setEditing(false);
  }
  function onComposing(value: boolean) {
    composing.current = value;
    context?.onComposing(value);
    if (!value && pendingBlur.current) blur();
  }
  function history(redo: boolean) {
    if (redo) editor.commands.redo();
    else editor.commands.undo();
    const position = getPos();
    if (position !== undefined) editor.commands.setNodeSelection(position);
  }
  useEffect(
    () => () => {
      if (composing.current) context?.onComposing(false);
    },
    [context],
  );
  return {
    latex,
    display,
    editing,
    preview,
    begin,
    blur,
    onComposing,
    history,
    change: (value: string) => updateAttributes({ latex: value }),
  };
}
