import {
  generateHTML,
  Node,
  type Extensions,
  type JSONContent,
  type NodeViewRenderer,
} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { InlineMath, BlockMath } from '@tiptap/extension-mathematics';
import Image from '@tiptap/extension-image';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';

import { SAFE_KATEX_OPTIONS } from './math-options';
import { inlineMathMarkdown } from './math-native';
import { imageParseEditorMathToken } from './imageParseEditorMath';

/** A preserved node for source text whose syntax is unsupported; the source is not inserted as editor HTML. */
export const PreservedImageParseSource = Node.create({
  name: 'preservedSource',
  group: 'block',
  atom: true,
  draggable: false,
  addAttributes() {
    return {
      source: {
        default: '',
        parseHTML: (element) => {
          try {
            return decodeURIComponent(element.getAttribute('data-ocr-preserved-source') ?? '');
          } catch {
            return '';
          }
        },
        renderHTML: ({ source }) => ({
          'data-ocr-preserved-source': encodeURIComponent(String(source)),
        }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-ocr-preserved-source]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', HTMLAttributes];
  },
  renderMarkdown: (node: JSONContent) => String(node.attrs?.source ?? ''),
});

function tableHtml(node: JSONContent, extensions: Extensions) {
  const html = generateHTML({ type: 'doc', content: [node] }, extensions);
  const fragment = new DOMParser().parseFromString(html, 'text/html');
  fragment.querySelectorAll('td, th').forEach((cell) => {
    const align = (cell as HTMLElement).style.textAlign;
    if (['left', 'center', 'right'].includes(align)) cell.setAttribute('align', align);
  });
  // A table must not be flattened to pipe Markdown; formulas use a safe code node supported by the existing preview pipeline.
  fragment
    .querySelectorAll('[data-type="inline-math"], [data-type="block-math"]')
    .forEach((math) => {
      const code = fragment.createElement('code');
      code.className =
        math.getAttribute('data-type') === 'block-math' ? 'math-display' : 'math-inline';
      code.textContent = math.getAttribute('data-latex') ?? '';
      math.replaceWith(code);
    });
  return fragment.body.querySelector('table')?.outerHTML ?? '';
}

/**
 * Rich-text edit extensions for OCR; tables always export HTML, and the Tiptap schema handles merged and nested content.
 * @param preserved optional React node view; tests and calls with no view keep the basic preserved node
 */
export function imageParseEditorExtensions(
  preserved = PreservedImageParseSource,
  mathNodeView?: NodeViewRenderer,
): Extensions {
  const extensions: Extensions = [
    StarterKit.configure({
      trailingNode: false,
      underline: false,
      link: { openOnClick: false, autolink: false },
    }),
    Markdown.configure({ markedOptions: { gfm: true } }),
    Table.extend({
      renderMarkdown: (node: JSONContent) => tableHtml(node, extensions),
    }).configure({ resizable: false, renderWrapper: true }),
    TableRow,
    TableCell,
    TableHeader,
    InlineMath.extend({
      ...(mathNodeView ? { addNodeView: () => mathNodeView } : {}),
      renderMarkdown: (node: JSONContent) => inlineMathMarkdown(String(node.attrs?.latex ?? '')),
      markdownTokenizer: {
        name: 'inlineMath',
        level: 'inline',
        start: (source) => source.indexOf('$'),
        tokenize: (source) => imageParseEditorMathToken(source, false),
      },
      parseHTML() {
        return [
          ...(this.parent?.() ?? []),
          // DOM rules must match before the generic code mark, or importing again drops the formula node.
          {
            tag: 'code.math-inline',
            priority: 100,
            getAttrs: (element) => ({ latex: element.textContent }),
          },
        ];
      },
    }).configure({ katexOptions: SAFE_KATEX_OPTIONS }),
    BlockMath.extend({
      ...(mathNodeView ? { addNodeView: () => mathNodeView } : {}),
      markdownTokenizer: {
        name: 'blockMath',
        level: 'block',
        // marked finds paragraph breaks in text with the first character removed, and cannot match the suffix of a multi-dollar fence.
        start: (source) => {
          const index = source.search(/\n\$\$(?!\$)/);
          return index < 0 ? -1 : index + 1;
        },
        tokenize: (source) => imageParseEditorMathToken(source, true),
      },
      parseHTML() {
        return [
          ...(this.parent?.() ?? []),
          {
            tag: 'code.math-display',
            priority: 100,
            getAttrs: (element) => ({ latex: element.textContent }),
          },
        ];
      },
    }).configure({ katexOptions: { ...SAFE_KATEX_OPTIONS, displayMode: true } }),
    Image.configure({ allowBase64: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    preserved,
  ];
  return extensions;
}
