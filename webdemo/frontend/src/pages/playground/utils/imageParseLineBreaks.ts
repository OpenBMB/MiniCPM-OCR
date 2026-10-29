interface DocumentNode {
  type: string;
  tagName?: string;
  value?: string;
  children?: DocumentNode[];
}

/** OCR 文本中的显式 br 形态；双层转义在 Markdown 解码一次后仍会残留实体。 */
const TEXT_LINE_BREAK = /(?:<|&(?:lt|#60|#x3c);)br\s*\/?\s*(?:>|&(?:gt|#62|#x3e);)/gi;
const TEXT_LINE_BREAK_ONCE = new RegExp(TEXT_LINE_BREAK.source, 'i');

/** 将文字内容中的显式 br 转成目标字符；不修改其它转义 HTML。 */
export function imageParseTextLineBreaks(value: string, replacement: string) {
  return value.replace(TEXT_LINE_BREAK, replacement);
}

/** 将 DOM 正文中的显式 br 替换为换行元素，返回是否发生转换；代码保持原样。 */
export function replaceImageParseTextLineBreaks(root: ParentNode): boolean {
  const document = root.ownerDocument ?? (root as Document);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (text) =>
      text.parentElement?.closest('code, pre, script, style, textarea, title')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  let changed = false;
  for (const text of texts) {
    const lines = text.data.split(TEXT_LINE_BREAK_ONCE);
    if (lines.length === 1) continue;
    const fragment = document.createDocumentFragment();
    lines.forEach((line, index) => {
      if (index) fragment.appendChild(document.createElement('br'));
      if (line) fragment.appendChild(document.createTextNode(line));
    });
    text.replaceWith(fragment);
    changed = true;
  }
  return changed;
}

/**
 * 将 OCR 预览中被转义的 br 文本恢复为换行节点，不改写源文档或解析其他 HTML。
 * @returns HTML 解析后的语法树转换器；代码块与行内代码保持原样
 */
export function imageParseLineBreaks() {
  return (tree: DocumentNode) => {
    function visit(node: DocumentNode) {
      if (node.tagName === 'pre' || node.tagName === 'code') return;
      if (!node.children) return;
      node.children = node.children.flatMap((child): DocumentNode[] => {
        if (child.type === 'text' && child.value && /[<&]/.test(child.value)) {
          const lines = child.value.split(TEXT_LINE_BREAK_ONCE);
          if (lines.length > 1) {
            return lines.flatMap((value, index): DocumentNode[] => [
              ...(index > 0 ? [{ type: 'element', tagName: 'br', children: [] }] : []),
              ...(value ? [{ type: 'text', value }] : []),
            ]);
          }
        }
        visit(child);
        return [child];
      });
    }
    visit(tree);
  };
}
