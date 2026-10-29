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
// HTML 的缩进是排版空白；代码语义只由外层 code/pre 标签决定。
PARSER.data('micromarkExtensions', [{ disable: { null: ['codeIndented'] } }]);
const PROTECTED_TAGS = new Set(['code', 'pre', 'script', 'style', 'textarea', 'title']);
const PROTECTED_SELECTOR = [...PROTECTED_TAGS].join(',');

/** 用现有 Markdown 数学解析器提取显式公式，非公式文本不经过 Markdown 转换。 */
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
        // remark 允许 EOF 结束数学围栏；OCR 未闭合或带元数据的内容必须原样保留。
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
  // 原生公式直接生成节点，不能经美元符中转，否则正文的 \$ 或 verb 会截断公式。
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
 * HTML 解析后将单元格的显式公式转为 KaTeX 输入节点，不改变源码及表格位置。
 * @returns 供 OCR 文档预览使用的语法树转换器；代码和单元格外文本不处理
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
        // GFM 单元格已经经过 remark-math 和反斜杠解码，禁止再次推断它的文本。
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
 * 富文本导入前将 HTML 单元格的公式转为已有数学扩展支持的 code 节点。
 * @param root 已由 DOMParser 解析且通过编辑器支持性检查的 HTML
 * @returns 是否转换了公式；属性、代码和转义 HTML 保持原有语义
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
