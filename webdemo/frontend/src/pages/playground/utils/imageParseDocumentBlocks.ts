import type { ImageParseTextRange } from './imageParseBlocks';
import { imageParseSourceBlocks, isImageParseSourceBlockEditable } from './imageParseEditorSource';
import { normalizeMathDelimiters } from './math';

/** Correspondence between a source document block and the normalized preview; only a clearly matched block may be edited. */
export interface ImageParseDocumentBlock extends ImageParseTextRange {
  normalized: ImageParseTextRange;
}

/**
 * Locate by top-level semantic blocks of the Markdown AST; do not split tables, lists, or quotes, and do not guess ambiguous ranges.
 * @param source original draft
 * @param normalized full normalized text used by the preview
 */
export function imageParseDocumentBlocks(
  source: string,
  normalized: string,
  detectBareMath = false,
): ImageParseDocumentBlock[] {
  const blocks: ImageParseDocumentBlock[] = [];
  let cursor = 0;
  for (const node of imageParseSourceBlocks(source)) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    const fragment = normalizeMathDelimiters(source.slice(start, end), {
      detectBareMath,
    });
    const offset = normalized.indexOf(fragment, cursor);
    if (offset < 0) continue;
    cursor = offset + fragment.length;
    if (isImageParseSourceBlockEditable(node)) {
      blocks.push({ start, end, normalized: { start: offset, end: cursor } });
    }
  }
  return blocks;
}

interface PreviewNode {
  type: string;
  tagName?: string;
  children?: PreviewNode[];
  properties?: Record<string, unknown>;
  position?: { start: { offset?: number }; end: { offset?: number } };
}

/** Add trusted block ranges to sanitized preview nodes; the whole document still shares one Markdown render. */
export function imageParseDocumentBlockMarkers(blocks: readonly ImageParseDocumentBlock[]) {
  return (tree: PreviewNode) => {
    const children: PreviewNode[] = [];
    const wrappers = new Map<ImageParseDocumentBlock, PreviewNode>();
    let previous: PreviewNode | undefined;
    for (const node of tree.children ?? []) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      // Binary search, so nodes and block ranges in a long document do not walk in quadratic time.
      let low = 0;
      let high = blocks.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (start !== undefined && blocks[middle].normalized.start <= start) low = middle + 1;
        else high = middle;
      }
      const candidate = blocks[low - 1];
      const block =
        candidate && start !== undefined && end !== undefined && end <= candidate.normalized.end
          ? candidate
          : undefined;
      if (node.type === 'text' && previous) {
        previous.children?.push(node);
      } else if (!block || node.type !== 'element') {
        children.push(node);
        previous = undefined;
      } else {
        let wrapper = wrappers.get(block);
        if (!wrapper) {
          wrapper = {
            type: 'element',
            tagName: 'div',
            properties: { dataEditStart: block.start, dataEditEnd: block.end },
            position: {
              start: { offset: block.normalized.start },
              end: { offset: block.normalized.end },
            },
            children: [],
          };
          wrappers.set(block, wrapper);
          children.push(wrapper);
        }
        wrapper.children?.push(node);
        previous = wrapper;
      }
    }
    tree.children = children;
  };
}

/** When an edit fragment is imported it carries the whole document's link definitions; export still updates only that fragment. */
export function imageParseReferenceDefinitions(source: string): string {
  return imageParseSourceBlocks(source)
    .filter((node) => node.type === 'definition')
    .map((node) => source.slice(node.position?.start.offset, node.position?.end.offset))
    .join('\n');
}
