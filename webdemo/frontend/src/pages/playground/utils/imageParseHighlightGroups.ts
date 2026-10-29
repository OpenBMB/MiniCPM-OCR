import type { ImageParsePreviewNode } from './imageParseHighlight';

interface LinkedNode {
  id: string;
  count: number;
}

const CONTAINERS = new Set(['div', 'ul', 'ol']);

/**
 * When consecutive semantic nodes belong to the same OCR block, share the outer positioning and edit range, and leave the body structure unchanged.
 * A list is grouped only when the whole list belongs to one block, so an illegal container is not inserted inside ul/ol and other blocks are not merged.
 */
export function groupImageParseHighlightNodes(
  tree: ImageParsePreviewNode,
  matchingIds: Map<ImageParsePreviewNode, string[]>,
): void {
  const cache = new Map<ImageParsePreviewNode, LinkedNode | undefined>();
  function linkedNode(node: ImageParsePreviewNode): LinkedNode | undefined {
    if (cache.has(node)) return cache.get(node);
    const ids = matchingIds.get(node);
    let linked: LinkedNode | undefined;
    if (ids?.length === 1) linked = { id: ids[0], count: 1 };
    else if (!ids?.length && node.tagName && CONTAINERS.has(node.tagName)) {
      const children = node.children?.filter((child) => !isWhitespace(child)) ?? [];
      for (const child of children) {
        const next = linkedNode(child);
        if (!next || (linked && linked.id !== next.id)) {
          linked = undefined;
          break;
        }
        linked = { id: next.id, count: (linked?.count ?? 0) + next.count };
      }
    }
    cache.set(node, linked);
    return linked;
  }

  function clearLinks(node: ImageParsePreviewNode) {
    matchingIds.delete(node);
    node.children?.forEach(clearLinks);
  }

  function group(parent: ImageParsePreviewNode) {
    const children: ImageParsePreviewNode[] = [];
    let pending: ImageParsePreviewNode[] = [];
    let linked: LinkedNode | undefined;
    function flush() {
      if (linked && linked.count > 1) {
        const elements = pending.filter((node) => !isWhitespace(node));
        const wrapper: ImageParsePreviewNode = {
          type: 'element',
          tagName: 'div',
          properties: { dataOcrGroupId: linked.id, className: ['flow-root'] },
          position: {
            start: elements[0].position!.start,
            end: elements[elements.length - 1].position!.end,
          },
          children: groupEditNodes(pending),
        };
        pending.forEach(clearLinks);
        matchingIds.set(wrapper, [linked.id]);
        children.push(wrapper);
      } else {
        children.push(...pending);
      }
      pending = [];
      linked = undefined;
    }

    for (const node of parent.children ?? []) {
      if (isWhitespace(node) && pending.length) {
        pending.push(node);
        continue;
      }
      const next = linkedNode(node);
      if (next) {
        if (linked?.id !== next.id) flush();
        linked = { id: next.id, count: (linked?.count ?? 0) + next.count };
        pending.push(node);
      } else {
        flush();
        // Do not regroup inside a list; list items still keep their structure and independent positioning on the original li.
        if (node.tagName === 'div') group(node);
        children.push(node);
      }
    }
    flush();
    parent.children = children;
  }
  group(tree);
}

function isWhitespace(node: ImageParsePreviewNode): boolean {
  return node.type === 'text' && !node.value?.trim();
}

function groupEditNodes(nodes: ImageParsePreviewNode[]): ImageParsePreviewNode[] {
  const elements = nodes.filter((node) => !isWhitespace(node));
  // Merge only edit shells that all have a trusted source range; keep the boundary of content that cannot be edited.
  if (
    !elements.every(
      (node) =>
        node.tagName === 'div' &&
        typeof node.properties?.dataEditStart === 'number' &&
        typeof node.properties.dataEditEnd === 'number',
    )
  )
    return nodes;
  return [
    {
      type: 'element',
      tagName: 'div',
      properties: {
        dataEditStart: elements[0].properties!.dataEditStart,
        dataEditEnd: elements[elements.length - 1].properties!.dataEditEnd,
      },
      position: {
        start: elements[0].position!.start,
        end: elements[elements.length - 1].position!.end,
      },
      children: nodes.flatMap((node) => (isWhitespace(node) ? [node] : (node.children ?? []))),
    },
  ];
}
