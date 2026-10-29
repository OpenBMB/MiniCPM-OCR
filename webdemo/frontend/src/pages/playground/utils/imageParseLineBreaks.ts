interface DocumentNode {
  type: string;
  tagName?: string;
  value?: string;
  children?: DocumentNode[];
}

/** Explicit br forms in OCR text; a double-escaped form still leaves an entity after one Markdown decode. */
const TEXT_LINE_BREAK = /(?:<|&(?:lt|#60|#x3c);)br\s*\/?\s*(?:>|&(?:gt|#62|#x3e);)/gi;
const TEXT_LINE_BREAK_ONCE = new RegExp(TEXT_LINE_BREAK.source, 'i');

/** Turn an explicit br in text content into the target character; do not modify other escaped HTML. */
export function imageParseTextLineBreaks(value: string, replacement: string) {
  return value.replace(TEXT_LINE_BREAK, replacement);
}

/** Replace an explicit br in DOM body text with a line-break element and return whether a conversion happened; code stays as-is. */
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
 * Restore escaped br text in the OCR preview to line-break nodes, without rewriting the source document or parsing other HTML.
 * @returns a syntax-tree transform after HTML parsing; code blocks and inline code stay as-is
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
