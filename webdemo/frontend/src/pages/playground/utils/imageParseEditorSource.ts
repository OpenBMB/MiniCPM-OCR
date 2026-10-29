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
  // Comments and special HTML must not silently disappear when imported through the schema.
  const walker = fragment.createTreeWalker(fragment, NodeFilter.SHOW_COMMENT);
  if (walker.nextNode()) return false;
  return [...fragment.body.querySelectorAll('*')].every((element) => {
    if (!HTML_TAGS.has(element.tagName.toLowerCase())) return false;
    return [...element.attributes].every(({ name, value: attribute }) => {
      if (HTML_ATTRIBUTES.has(name)) return true;
      if (name === 'class' && element.tagName === 'CODE') {
        return /^(language-[\w-]+|math-inline|math-display)$/.test(attribute);
      }
      // Column widths and GFM alignment exported by Tiptap are rebuildable attributes; other styles keep the original text.
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

/** A single- or double-escaped br in OCR source text; it only enters text content. Code and formulas are protected by AST boundaries. */
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

/** Editable HTML recognizes cell formulas before restoring line breaks, so a br inside a formula is not turned into a DOM node by mistake. */
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

/** Whether a complete semantic block can enter visual editing; image placeholders and unknown structure stay in preview. */
export function isImageParseSourceBlockEditable(node: SourceNode): boolean {
  return node.type !== 'definition' && supported(node);
}

/**
 * Use the Markdown AST to recognize complete blocks the editor does not support, and import them as preserved nodes.
 * Preserved blocks are still shown safely by the original previewer, and export restores the original text directly, with no lossy conversion.
 * @param source original OCR draft
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
      // HTML cell formulas have already produced a code node; do not normalize the LaTeX or code inside them again.
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

/** Extract copyable text from the AST, keeping code, formulas, and image alt text. */
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

/** Turn formula code in HTML back into text with delimiters, so it can be pasted back into Markdown after copying. */
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

/** Get the top-level blocks of the shared parser, so table export follows the same GFM syntax rules. */
export function imageParseSourceBlocks(source: string): SourceNode[] {
  return (SOURCE_PARSER.parse(source) as SourceNode).children ?? [];
}
