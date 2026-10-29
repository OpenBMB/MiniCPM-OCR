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
 * Tiptap 编辑生命周期与保存；未改变文档时保留逐字符一致的原始草稿。
 * @param source 当前结果草稿
 * @param extensions OCR schema 和安全配置
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
    // 历史事务可能恢复普通文本选区；公式属性编辑仍留在原节点，不关闭源码输入框。
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
        // 不拦截模型原有的非法公式，只阻止把本次新增或修改的非法 LaTeX 保存回正文。
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
    // 会话内容不在编辑期间更新；官方 useEditor 管理卸载，显式切块同步 destroy。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, register]);
  return { editor, state, error, history, formulaContext };
}
