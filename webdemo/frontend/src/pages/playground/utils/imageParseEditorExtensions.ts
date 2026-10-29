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

/** 未支持语法的原文保留节点；不会把原文当成编辑器 HTML 插入。 */
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
  // 表格不能压成 pipe Markdown；公式用现有预览管线支持的安全 code 节点表示。
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
 * OCR 富文本编辑扩展；表格固定导出 HTML，交给 Tiptap schema 处理合并和嵌套内容。
 * @param preserved 可选的 React 节点视图，测试和无视图调用沿用基础保留节点
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
          // DOM 规则需先于通用 code 标记匹配，否则再次导入会丢失公式节点。
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
        // marked 用去掉首字符的文本寻找段落中断点，不能匹配多美元围栏的后缀。
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
