import type { ImageParseTextRange } from './imageParseBlocks';
import { comparableImageParseFormula } from './imageParseFormulaMarkdown';
import { groupImageParseHighlightNodes } from './imageParseHighlightGroups';

/** 消毒后的预览语法树节点；定位与分组只添加可信属性。 */
export interface ImageParsePreviewNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: ImageParsePreviewNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

/** 渲染后的语义节点与原图识别块的对应关系。 */
export interface ImageParseLinkedRange {
  id: string;
  range: ImageParseTextRange;
}

const BLOCK_TAGS = new Set([
  'p',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'table',
  'pre',
  'blockquote',
]);

/**
 * 在 Markdown 语法树上标记对应的语义块，不注入 HTML，也不拆散表格或公式。
 * 高亮保留整块的 Markdown 结构，源偏移必须与传入渲染器的文本一致。
 */
export function imageParseHighlight(
  range?: ImageParseTextRange,
  linkedRanges: readonly ImageParseLinkedRange[] = [],
  deduplicateFormulas = false,
) {
  return (tree: ImageParsePreviewNode) => {
    if (!range && !linkedRanges.length && !deduplicateFormulas) return;
    const indexed = linkedRanges
      .map((item, order) => ({ ...item, order }))
      .sort((left, right) => left.range.start - right.range.start);
    const maxEnds: number[] = [];
    indexed.forEach((item, index) => {
      maxEnds.push(Math.max(maxEnds[index - 1] ?? -Infinity, item.range.end));
    });
    const matches = (start: number, end: number) => {
      // 前缀最大终点支持重叠范围；普通按阅读顺序排列的块只访问相邻命中项。
      let low = 0;
      let high = indexed.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (indexed[middle].range.start < end) low = middle + 1;
        else high = middle;
      }
      const found: typeof indexed = [];
      for (let index = low - 1; index >= 0 && maxEnds[index] > start; index--) {
        if (indexed[index].range.end > start) found.push(indexed[index]);
      }
      return found.sort((left, right) => left.order - right.order);
    };
    const matchingIds = new Map<ImageParsePreviewNode, string[]>();
    const displayMath = new Map<ImageParsePreviewNode, string>();
    const aliasedHighlights = new Set<ImageParsePreviewNode>();

    function collect(node: ImageParsePreviewNode) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (
        node.tagName &&
        BLOCK_TAGS.has(node.tagName) &&
        start !== undefined &&
        end !== undefined
      ) {
        const matching = matches(start, end);
        if (matching.length)
          matchingIds.set(
            node,
            matching.map(({ id }) => id),
          );
      }
      if (isDisplayMathPre(node) && start !== undefined && end !== undefined) {
        displayMath.set(node, comparableImageParseFormula(nodeText(node)));
      }
      node.children?.forEach(collect);
    }
    collect(tree);

    // 兼容已经打开的旧草稿：只合并紧邻的重复表示，将旧范围转移到显示公式。
    // 不跨正文寻找相同公式，也不把两个不同原图区域合并为一个点击目标。
    if (deduplicateFormulas) {
      const children: ImageParsePreviewNode[] = [];
      let previousMath: ImageParsePreviewNode | undefined;
      for (const child of tree.children ?? []) {
        const node = semanticNode(child);
        if (node.type === 'text' && !node.value?.trim()) {
          children.push(child);
          continue;
        }
        const start = node.position?.start.offset;
        const end = node.position?.end.offset;
        const ids = matchingIds.get(node) ?? [];
        const previousIds = previousMath ? (matchingIds.get(previousMath) ?? []) : [];
        const distinctBlocks =
          ids.length > 0 && previousIds.length > 0 && ids.some((id) => !previousIds.includes(id));
        if (
          previousMath &&
          node.tagName === 'p' &&
          displayMath.get(previousMath) === comparableImageParseFormula(nodeText(node)) &&
          !distinctBlocks
        ) {
          matchingIds.set(previousMath, [...new Set([...previousIds, ...ids])]);
          if (
            range &&
            start !== undefined &&
            end !== undefined &&
            start < range.end &&
            end > range.start
          )
            aliasedHighlights.add(previousMath);
          continue;
        }
        children.push(child);
        previousMath = displayMath.has(node) ? node : undefined;
      }
      tree.children = children;
    }

    groupImageParseHighlightNodes(tree, matchingIds);

    function visit(node: ImageParsePreviewNode) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (
        node.tagName &&
        (BLOCK_TAGS.has(node.tagName) || node.properties?.dataOcrGroupId !== undefined) &&
        start !== undefined &&
        end !== undefined
      ) {
        const highlighted =
          aliasedHighlights.has(node) || Boolean(range && start < range.end && end > range.start);
        const matching = matchingIds.get(node) ?? [];
        // 同一个语义节点对应多个原图块时不猜测，避免点错位置。
        const linkedId = matching.length === 1 ? matching[0] : undefined;
        if (highlighted || matching.length) {
          const existingClass = node.properties?.className;
          const classes = Array.isArray(existingClass) ? existingClass : [];
          // 表格由专用外壳控制描边与圆角，不能被普通文本选中样式覆盖。
          const highlightClasses =
            highlighted && node.tagName !== 'table'
              ? ['ring-1', 'ring-inset', 'ring-primary/60', 'rounded-sm']
              : [];
          if (node.tagName === 'pre') {
            // KaTeX 会替换 display-math 的 pre 节点，用外壳保留定位标记。
            const original = { ...node };
            node.tagName = 'div';
            node.children = [original];
            node.properties = {};
          }
          node.properties = {
            ...node.properties,
            ...(matching.length ? { dataOcrLinkedIds: JSON.stringify(matching) } : {}),
            ...(highlighted
              ? {
                  dataOcrHighlight: 'true',
                  className: [...classes, ...highlightClasses],
                }
              : {}),
            ...(linkedId
              ? {
                  dataOcrBlockId: linkedId,
                  role: 'button',
                  tabIndex: 0,
                  className: [
                    ...classes,
                    ...highlightClasses,
                    'cursor-pointer',
                    'hover:bg-primary/5',
                    'focus-visible:outline-none',
                    'focus-visible:ring-2',
                    'focus-visible:ring-ring',
                  ],
                }
              : {}),
          };
          // 已命中一个语义块，避免列表项与内部段落重复创建点击目标。
          return;
        }
      }
      node.children?.forEach(visit);
    }
    visit(tree);
  };
}

function nodeText(node: ImageParsePreviewNode): string {
  return node.value ?? node.children?.map(nodeText).join('') ?? '';
}

function isDisplayMathPre(node: ImageParsePreviewNode): boolean {
  if (node.tagName !== 'pre') return false;
  const code = node.children?.find((child) => child.tagName === 'code');
  const className = code?.properties?.className;
  const classes = Array.isArray(className) ? className : [className];
  return classes.includes('math-display');
}

function semanticNode(node: ImageParsePreviewNode): ImageParsePreviewNode {
  if (node.tagName !== 'div' || typeof node.properties?.dataEditStart !== 'number') return node;
  const children = node.children?.filter(
    (child) => child.type !== 'text' || Boolean(child.value?.trim()),
  );
  return children?.length === 1 ? children[0] : node;
}
