import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';

import { nativeMathRanges } from './math-native';

interface MathNode {
  type: string;
  tagName?: string;
  value?: string;
  meta?: string | null;
  properties?: Record<string, unknown>;
  children?: MathNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

interface MathPart {
  value: string;
  display?: boolean;
}

const PARSER = unified().use(remarkParse).use(remarkMath);
// HTML indentation is layout whitespace; code semantics are decided only by the outer code/pre tags.
PARSER.data('micromarkExtensions', [{ disable: { null: ['codeIndented'] } }]);
const PROTECTED_TAGS = new Set(['code', 'pre', 'script', 'style', 'textarea', 'title']);
const PROTECTED_SELECTOR = [...PROTECTED_TAGS].join(',');

/** Extract explicit formulas with the existing Markdown math parser; non-formula text does not go through Markdown conversion. */
function mathParts(value: string): MathPart[] {
  if (!/[$\\]/.test(value)) return [{ value }];
  const protectedRanges: { start: number; end: number }[] = [];
  const formulas: (MathPart & { start: number; end: number })[] = [];
  function visit(node: MathNode) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (node.type === 'code' || node.type === 'inlineCode') {
      if (start !== undefined && end !== undefined) protectedRanges.push({ start, end });
      return;
    }
    if (
      (node.type === 'math' || node.type === 'inlineMath') &&
      start !== undefined &&
      end !== undefined
    ) {
      protectedRanges.push({ start, end });
      if (node.type === 'math') {
        const raw = value.slice(start, end);
        const opening = raw.match(/^\${2,}/)?.[0].length ?? 0;
        const lastLine = raw.slice(raw.lastIndexOf('\n') + 1).trim();
        const closing = lastLine.match(/^\${2,}$/)?.[0].length ?? 0;
        // remark allows EOF to end a math fence; OCR content that is unclosed or carries metadata must be kept as-is.
        if (!raw.includes('\n') || closing < opening || node.meta) return;
      }
      formulas.push({
        start,
        end,
        value: node.value ?? '',
        display: node.type === 'math' || value.startsWith('$$', start),
      });
      return;
    }
    node.children?.forEach(visit);
  }
  visit(PARSER.parse(value) as MathNode);
  // A native formula produces a node directly and must not be routed through dollar signs, or a \$ or verb in the body would cut the formula off.
  formulas.push(...nativeMathRanges(value, protectedRanges));
  const parts: MathPart[] = [];
  let cursor = 0;
  for (const formula of formulas.sort((left, right) => left.start - right.start)) {
    if (formula.start < cursor) continue;
    if (formula.start > cursor) parts.push({ value: value.slice(cursor, formula.start) });
    parts.push({ value: formula.value, display: formula.display });
    cursor = formula.end;
  }
  if (!parts.length) return [{ value }];
  if (cursor < value.length) parts.push({ value: value.slice(cursor) });
  return parts;
}

/**
 * After HTML parsing, turn explicit formulas in cells into KaTeX input nodes, without changing the source or the table position.
 * @returns a syntax-tree transform for OCR document preview; code and text outside cells are not processed
 */
export function imageParseHtmlMath() {
  return (tree: MathNode, file: { value?: unknown }) => {
    const source = String(file.value ?? '');
    function visit(node: MathNode, inCell = false) {
      if (node.tagName && PROTECTED_TAGS.has(node.tagName)) return;
      if (!node.children) return;
      let cell = inCell;
      if (node.tagName === 'td' || node.tagName === 'th') {
        const start = node.position?.start.offset;
        // A GFM cell has already passed through remark-math and backslash decoding; do not infer its text again.
        cell = start !== undefined && /^<(?:td|th)(?:\s|>)/i.test(source.slice(start, start + 4));
      }
      node.children = node.children.flatMap((child): MathNode[] => {
        if (cell && child.type === 'text' && child.value) {
          return mathParts(child.value).map((part) =>
            part.display === undefined
              ? { type: 'text', value: part.value }
              : {
                  type: 'element',
                  tagName: 'code',
                  properties: { className: [part.display ? 'math-display' : 'math-inline'] },
                  children: [{ type: 'text', value: part.value }],
                },
          );
        }
        visit(child, cell);
        return [child];
      });
    }
    visit(tree);
  };
}

/**
 * Before rich-text import, turn formulas in HTML cells into code nodes the existing math extension supports.
 * @param root HTML already parsed by DOMParser and checked as supported by the editor
 * @returns whether a formula was converted; attributes, code, and escaped HTML keep their original meaning
 */
export function replaceImageParseHtmlMath(root: ParentNode): boolean {
  const document = root.ownerDocument ?? (root as Document);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (text) =>
      text.parentElement?.closest('td, th') && !text.parentElement.closest(PROTECTED_SELECTOR)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT,
  });
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  let changed = false;
  for (const text of texts) {
    const parts = mathParts(text.data);
    if (!parts.some((part) => part.display !== undefined)) continue;
    const fragment = document.createDocumentFragment();
    for (const part of parts) {
      if (part.display === undefined) {
        fragment.appendChild(document.createTextNode(part.value));
      } else {
        const code = document.createElement('code');
        code.className = part.display ? 'math-display' : 'math-inline';
        code.textContent = part.value;
        fragment.appendChild(code);
      }
    }
    text.replaceWith(fragment);
    changed = true;
  }
  return changed;
}
