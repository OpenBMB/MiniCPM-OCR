import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useEditor, useEditorState } from '@tiptap/react';
import type { Extensions } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';

import type { ImageParseBlockController } from './useImageParseVisualEditor';

import { prepareImageParseEditorSource } from '../utils/imageParseEditorSource';
import { isSupportedKatex } from '../utils/math-katex';
import type { ImageParseFormulaTarget } from '../utils/imageParseFormulaEditContext';

const MATH_TYPES = new Set(['blockMath', 'inlineMath']);

/**
 * Tiptap edit lifecycle and save; when the document is unchanged, keep the original draft identical character by character.
 * @param source current result draft
 * @param extensions OCR schema and safe config
 */
export function useImageParseRichEditor(
  source: string,
  extensions: Extensions,
  label: string,
  definitions: string,
  onSave: (value: string) => void,
  register: (controller: ImageParseBlockController) => void,
  initialMath: ImageParseFormulaTarget | null,
) {
  const initialDoc = useRef<Node | null>(null);
  const mathComposing = useRef(false);
  const [error, setError] = useState(false);
  const content = useMemo(
    () => prepareImageParseEditorSource(source + (definitions ? '\n\n' + definitions : '')),
    [source, definitions],
  );
  const editor = useEditor({
    extensions,
    content,
    contentType: 'markdown',
    immediatelyRender: false,
    onCreate: ({ editor: instance }) => {
      initialDoc.current = instance.state.doc;
      let position: number | undefined;
      let occurrence = 0;
      if (initialMath) {
        instance.state.doc.descendants((node, pos) => {
          if (!MATH_TYPES.has(node.type.name) || node.attrs.latex !== initialMath.latex) return;
          if (occurrence === initialMath.occurrence) position = pos;
          occurrence += 1;
        });
      }
      if (position !== undefined) {
        instance.commands.setNodeSelection(position);
        return;
      }
      if (
        instance.state.doc.childCount === 1 &&
        instance.state.doc.firstChild?.type.name === 'blockMath'
      ) {
        instance.commands.setNodeSelection(0);
      } else {
        instance.commands.focus('start');
      }
    },
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': label,
        'aria-multiline': 'true',
        spellcheck: 'false',
      },
    },
  });
  const state = useEditorState({
    editor,
    selector: ({ editor: instance }) => {
      const selection = instance?.state.selection;
      const math =
        selection instanceof NodeSelection && MATH_TYPES.has(selection.node.type.name)
          ? {
              pos: selection.from,
              type: selection.node.type.name,
              latex: String(selection.node.attrs.latex ?? ''),
            }
          : null;
      return {
        bold: instance?.isActive('bold') ?? false,
        italic: instance?.isActive('italic') ?? false,
        heading: instance?.isActive('heading', { level: 2 }) ?? false,
        list: instance?.isActive('bulletList') ?? false,
        canUndo: instance?.can().undo() ?? false,
        canRedo: instance?.can().redo() ?? false,
        inTable: instance?.isActive('table') ?? false,
        canMerge: instance?.can().mergeCells() ?? false,
        canSplit: instance?.can().splitCell() ?? false,
        math,
      };
    },
  });
  function history(redo: boolean) {
    if (!editor) return;
    const math = state?.math;
    if (redo) editor.commands.redo();
    else editor.commands.undo();
    // A history transaction may restore an ordinary text selection; formula-attribute editing stays on the original node and does not close the source input.
    if (math && editor.state.doc.nodeAt(math.pos)?.type.name === math.type) {
      editor.commands.setNodeSelection(math.pos);
    } else {
      editor.commands.focus();
    }
  }
  const setMathComposing = useCallback((value: boolean) => {
    mathComposing.current = value;
  }, []);
  const formulaContext = useMemo(
    () => ({ initial: initialMath, onComposing: setMathComposing }),
    [initialMath, setMathComposing],
  );
  function flushOpenFormula() {
    if (!editor || editor.isDestroyed) return;
    const field = editor.view.dom.querySelector<HTMLTextAreaElement>('textarea[name="latex"]');
    if (!field) return;
    const selection = editor.state.selection;
    if (!(selection instanceof NodeSelection) || !MATH_TYPES.has(selection.node.type.name)) return;
    if (String(selection.node.attrs.latex ?? '') === field.value) return;
    editor.commands.updateAttributes(selection.node.type.name, { latex: field.value });
  }
  function save(): boolean {
    if (!editor) return false;
    try {
      flushOpenFormula();
      const unchanged = initialDoc.current?.eq(editor.state.doc);
      if (!unchanged) {
        // Do not intercept an illegal formula the model already had; only stop illegal LaTeX that was added or changed this time from being saved back into the body.
        const originals = new Set<string>();
        initialDoc.current?.descendants((node) => {
          if (MATH_TYPES.has(node.type.name)) originals.add(String(node.attrs.latex ?? ''));
        });
        let valid = true;
        editor.state.doc.descendants((node) => {
          if (!MATH_TYPES.has(node.type.name)) return;
          const latex = String(node.attrs.latex ?? '');
          if (!originals.has(latex) && (!latex.trim() || !isSupportedKatex(latex))) valid = false;
        });
        if (!valid) {
          setError(true);
          return false;
        }
      }
      const value = unchanged ? source : editor.getMarkdown();
      onSave(value);
      setError(false);
      return true;
    } catch {
      setError(true);
      return false;
    }
  }
  useLayoutEffect(() => {
    if (!editor) return;
    initialDoc.current = editor.state.doc;
    register({
      save,
      destroy: () => {
        if (!editor.isDestroyed) editor.destroy();
      },
      composing: () => mathComposing.current || (!editor.isDestroyed && editor.view.composing),
    });
    // Session content is not updated during editing; the official useEditor manages unmount, and an explicit block switch destroys synchronously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, register]);
  return { editor, state, error, history, formulaContext };
}
