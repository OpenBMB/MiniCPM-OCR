import type { ImageParseTextRange } from './imageParseBlocks';
import { imageParseSourceBlocks, isImageParseSourceBlockEditable } from './imageParseEditorSource';
import { normalizeMathDelimiters } from './math';

/** 源文档块与规范化预览的对应关系；只允许明确匹配的块进入编辑。 */
export interface ImageParseDocumentBlock extends ImageParseTextRange {
  normalized: ImageParseTextRange;
}

/**
 * 按 Markdown AST 的顶层语义块定位；不拆开表格、列表或引用，也不猜测有歧义的范围。
 * @param source 原草稿
 * @param normalized 预览使用的完整规范化文本
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

/** 消毒后的预览节点添加可信块范围，整份文档仍共用一次 Markdown 渲染。 */
export function imageParseDocumentBlockMarkers(blocks: readonly ImageParseDocumentBlock[]) {
  return (tree: PreviewNode) => {
    const children: PreviewNode[] = [];
    const wrappers = new Map<ImageParseDocumentBlock, PreviewNode>();
    let previous: PreviewNode | undefined;
    for (const node of tree.children ?? []) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      // 二分定位，避免长文档的节点与块范围产生平方级遍历。
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

/** 编辑片段导入时携带整份文档的链接定义，导出仍只更新该片段。 */
export function imageParseReferenceDefinitions(source: string): string {
  return imageParseSourceBlocks(source)
    .filter((node) => node.type === 'definition')
    .map((node) => source.slice(node.position?.start.offset, node.position?.end.offset))
    .join('\n');
}
