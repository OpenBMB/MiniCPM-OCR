import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import { imageParseTextLineBreaks, replaceImageParseTextLineBreaks } from './imageParseLineBreaks';
import { replaceImageParseHtmlMath } from './imageParseHtmlMath';
import { normalizeMathDelimiters } from './math';
import { splitJoinedDisplayFormulas } from './math-markdown';
import { inlineMathMarkdown } from './math-native';

interface SourceNode {
  type: string;
  value?: string;
  alt?: string;
  url?: string;
  children?: SourceNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

const SOURCE_PARSER = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const SUPPORTED_NODES = new Set([
  'root',
  'paragraph',
  'heading',
  'text',
  'strong',
  'emphasis',
  'delete',
  'link',
  'linkReference',
  'image',
  'imageReference',
  'definition',
  'break',
  'blockquote',
  'list',
  'listItem',
  'code',
  'inlineCode',
  'thematicBreak',
  'table',
  'tableRow',
  'tableCell',
  'math',
  'inlineMath',
  'html',
]);
const HTML_TAGS = new Set([
  'p',
  'br',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'b',
  'em',
  'i',
  'del',
  's',
  'blockquote',
  'ul',
  'ol',
  'li',
  'pre',
  'code',
  'a',
  'img',
  'hr',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'colgroup',
  'col',
]);
const HTML_ATTRIBUTES = new Set([
  'href',
  'title',
  'src',
  'alt',
  'colspan',
  'rowspan',
  'align',
  'start',
  'colwidth',
]);

function supportedHtml(value: string) {
  const fragment = new DOMParser().parseFromString(value, 'text/html');
  if (fragment.head.childNodes.length) return false;
  // 注释与特殊 HTML 不能经过 schema 导入时静默消失。
  const walker = fragment.createTreeWalker(fragment, NodeFilter.SHOW_COMMENT);
  if (walker.nextNode()) return false;
  return [...fragment.body.querySelectorAll('*')].every((element) => {
    if (!HTML_TAGS.has(element.tagName.toLowerCase())) return false;
    return [...element.attributes].every(({ name, value: attribute }) => {
      if (HTML_ATTRIBUTES.has(name)) return true;
      if (name === 'class' && element.tagName === 'CODE') {
        return /^(language-[\w-]+|math-inline|math-display)$/.test(attribute);
      }
      // Tiptap 导出的列宽与 GFM 对齐是可重建属性，其它样式保留原文。
      return (
        name === 'style' &&
        /^(TABLE|COL|TD|TH)$/.test(element.tagName) &&
        /^(?:(?:min-width|width|text-align):[^;]+;?\s*)+$/.test(attribute)
      );
    });
  });
}

function supported(node: SourceNode): boolean {
  if (!SUPPORTED_NODES.has(node.type)) return false;
  if (node.type === 'image' && !node.url) return false;
  if (node.type === 'html' && !supportedHtml(node.value ?? '')) return false;
  return node.children?.every(supported) ?? true;
}

/** OCR 源文本中的一或双层转义 br；仅进入文字内容，代码和公式由 AST 边界保护。 */
const ESCAPED_LINE_BREAK = /(?:&amp;|&)(?:lt|#60|#x3c);br\s*\/?\s*(?:&amp;|&)(?:gt|#62|#x3e);/gi;

interface SourceRange {
  start: number;
  end: number;
  value: string;
}

function collectTextLineBreaks(
  node: SourceNode,
  blockStart: number,
  block: string,
  ranges: SourceRange[],
) {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (node.type === 'text' && start !== undefined && end !== undefined) {
    const relativeStart = Math.max(0, start - blockStart);
    const relativeEnd = Math.min(block.length, end - blockStart);
    const raw = block.slice(relativeStart, relativeEnd);
    const value = raw.replace(ESCAPED_LINE_BREAK, '<br>');
    if (value !== raw) ranges.push({ start: relativeStart, end: relativeEnd, value });
    return;
  }
  node.children?.forEach((child) => collectTextLineBreaks(child, blockStart, block, ranges));
}

/** 可编辑 HTML 先识别单元格公式再恢复换行，避免公式中的 br 被误转为 DOM 节点。 */
function normalizeSupportedLineBreaks(block: string, node: SourceNode) {
  if (node.type === 'html') {
    if (!/[$\\]/.test(block) && !new RegExp(ESCAPED_LINE_BREAK.source, 'i').test(block))
      return block;
    const fragment = new DOMParser().parseFromString(block, 'text/html');
    const mathChanged = replaceImageParseHtmlMath(fragment.body);
    const breaksChanged = replaceImageParseTextLineBreaks(fragment.body);
    return mathChanged || breaksChanged ? fragment.body.innerHTML : block;
  }
  const ranges: SourceRange[] = [];
  collectTextLineBreaks(node, node.position?.start.offset ?? 0, block, ranges);
  return ranges
    .sort((left, right) => right.start - left.start)
    .reduce(
      (value, range) => value.slice(0, range.start) + range.value + value.slice(range.end),
      block,
    );
}

/** 判断完整语义块是否能进入可视化编辑，图片占位符与未知结构继续保持预览。 */
export function isImageParseSourceBlockEditable(node: SourceNode): boolean {
  return node.type !== 'definition' && supported(node);
}

/**
 * 使用 Markdown AST 识别编辑器不支持的完整块，将其作为保留节点导入。
 * 保留块仍由原预览器安全展示，导出时直接恢复原文，不做有损转换。
 * @param source 原始 OCR 草稿
 */
export function prepareImageParseEditorSource(source: string): string {
  const tree = SOURCE_PARSER.parse(source) as SourceNode;
  let result = '';
  let cursor = 0;
  for (const node of tree.children ?? []) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    const block = source.slice(start, end);
    result += normalizeMathDelimiters(source.slice(cursor, start), { detectBareMath: false });
    if (supported(node)) {
      const prepared = normalizeSupportedLineBreaks(block, node);
      // HTML 单元格公式已生成 code 节点；不能再规范化其内部 LaTeX 或代码内容。
      result +=
        node.type === 'html'
          ? prepared
          : normalizeMathDelimiters(prepared, { detectBareMath: false });
    } else {
      const encoded = encodeURIComponent(block);
      result += `<div data-ocr-preserved-source="${encoded}"></div>`;
    }
    cursor = end;
  }
  return result + normalizeMathDelimiters(source.slice(cursor), { detectBareMath: false });
}

/** 从 AST 提取可复制的文字，保留代码、公式与图片说明。 */
export function imageParseNodeText(
  node: SourceNode,
  options?: { mathDelimiters?: boolean },
): string {
  if (options?.mathDelimiters && node.type === 'inlineMath') {
    const latex = node.value ?? '';
    return latex ? inlineMathMarkdown(latex) : '';
  }
  if (options?.mathDelimiters && node.type === 'math') {
    const latex = (node.value ?? '').trim();
    return latex ? splitJoinedDisplayFormulas(`$$\n${latex}\n$$`) : '';
  }
  if (node.type === 'break') return '\n';
  if (node.type === 'text') return imageParseTextLineBreaks(node.value ?? '', '\n');
  if (node.type === 'image' || node.type === 'imageReference') return node.alt ?? '';
  if (node.type === 'html') {
    const fragment = new DOMParser().parseFromString(node.value ?? '', 'text/html');
    replaceImageParseTextLineBreaks(fragment.body);
    fragment.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    if (options?.mathDelimiters) wrapImageParseHtmlMath(fragment.body);
    return fragment.body.textContent ?? '';
  }
  return (
    node.value ?? node.children?.map((child) => imageParseNodeText(child, options)).join('') ?? ''
  );
}

/** 把 HTML 里的公式代码还原成带定界符的文本，供复制后贴回 Markdown。 */
function wrapImageParseHtmlMath(root: ParentNode) {
  root.querySelectorAll('code.math-inline, code.math-display').forEach((code) => {
    const latex = code.textContent ?? '';
    if (!latex) return;
    const wrapped = code.classList.contains('math-display')
      ? `$$\n${latex.trim()}\n$$`
      : inlineMathMarkdown(latex);
    code.replaceWith(wrapped);
  });
}

/** 获取统一解析器的顶层块，供表格导出沿用同一套 GFM 语法规则。 */
export function imageParseSourceBlocks(source: string): SourceNode[] {
  return (SOURCE_PARSER.parse(source) as SourceNode).children ?? [];
}
