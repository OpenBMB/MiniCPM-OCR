import { imageParseBlockId } from './imageParseBlocks';
import { rotateImageParseBlocks } from './imageParseRotation';
import type { ImageParseLayoutBlock } from './imageParseSample';
import { imageParsePdfScrollAnchors } from './imageParsePdfScrollAnchors';

interface Anchor {
  origin: number;
  result: number;
}
const bounded = (value: number) => Math.max(0, Math.min(1, value));

function internal(anchor: Anchor): boolean {
  return anchor.origin > 0 && anchor.origin < 1 && anchor.result > 0 && anchor.result < 1;
}

/** 使用可见原文和预览的同一块构建滚动锚点；无真实映射时不推断定位。 */
export function imageParseScrollAnchors(
  origin: HTMLElement | null,
  result: HTMLElement,
  blocks: readonly ImageParseLayoutBlock[],
  originProgress: number,
): readonly Anchor[] {
  if (!origin || !origin.clientHeight || !result.clientHeight) return [];
  const isPdf = origin.hasAttribute('data-pdf-viewport');
  if (
    isPdf &&
    (result.hasAttribute('data-ocr-continuous-pdf') || result.querySelector('[data-ocr-continuous-pdf]'))
  )
    return imageParsePdfScrollAnchors(origin, result, blocks);
  const currentPage = Number(origin.dataset.pdfCurrentPage);
  const activeCanvas = isPdf ? origin.querySelector<HTMLElement>('canvas[role="img"]') : null;
  // 页面骨架始终存在；离屏画布卸载时也不能退回整份 PDF 的滚动范围。
  const raster = isPdf
    ? (origin.querySelector<HTMLElement>(`[data-pdf-page="${currentPage}"]`) ??
      activeCanvas?.closest<HTMLElement>('[data-pdf-page]') ??
      activeCanvas)
    : origin.querySelector<HTMLElement>('[data-image-raster]');
  const bounds = raster?.getBoundingClientRect();
  if (!bounds?.height) return [];
  const originRange = Math.max(
    0,
    (isPdf ? origin.scrollHeight : bounds.height) - origin.clientHeight,
  );
  const resultRange = Math.max(0, result.scrollHeight - result.clientHeight);
  if (!originRange || !resultRange) return [];
  const originTop = origin.getBoundingClientRect().top;
  const actual = isPdf
    ? origin.scrollTop
    : Number(origin.dataset.imageProgress ?? originProgress) * originRange;
  const rasterOffset = bounds.top - originTop + actual;
  const endpoints: readonly [Anchor, Anchor] = isPdf
    ? [
        {
          origin: bounded(
            (rasterOffset - Math.max(0, origin.clientHeight - bounds.height) / 2) / originRange,
          ),
          result: 0,
        },
        {
          origin: bounded(
            (rasterOffset +
              Math.max(0, bounds.height - origin.clientHeight) -
              Math.max(0, origin.clientHeight - bounds.height) / 2) /
              originRange,
          ),
          result: 1,
        },
      ]
    : [
        { origin: 0, result: 0 },
        { origin: 1, result: 1 },
      ];
  const resultTop = result.getBoundingClientRect().top;
  const nodes = result.querySelectorAll<HTMLElement>('[data-ocr-linked-ids]');
  const positions = new Map<string, number>();
  nodes.forEach((node) => {
    if (node.closest('[data-visual-editing="true"]')) return;
    const rect = node.getBoundingClientRect();
    if (!rect.height) return;
    const ids: unknown = JSON.parse(node.dataset.ocrLinkedIds ?? '[]');
    if (!Array.isArray(ids)) return;
    ids.forEach((id: unknown) => {
      if (typeof id === 'string' && !positions.has(id)) {
        positions.set(id, bounded((rect.top - resultTop + result.scrollTop) / resultRange));
      }
    });
  });
  const rotation = Number(origin.dataset.pdfRotation ?? origin.dataset.imageRotation ?? 0);
  const anchors = rotateImageParseBlocks(blocks, rotation)
    .flatMap((block, index) => {
      const position = positions.get(imageParseBlockId(block, index));
      return position === undefined
        ? []
        : [
            {
              origin: bounded((rasterOffset + block.y * bounds.height) / originRange),
              result: position,
            },
          ];
    })
    .sort((a, b) => a.origin - b.origin);
  // 图片端点对应整张图片；PDF 结果只对应当前页，首尾不能跨到其他页面。
  // 旋转、合并段落可能产生重复或逆序锚点；只插值严格单调的真实对应关系。
  const ordered: Anchor[] = [];
  for (const anchor of anchors) {
    if (
      !internal(anchor) ||
      anchor.origin <= endpoints[0].origin ||
      anchor.origin >= endpoints[1].origin
    )
      continue;
    const previous = ordered[ordered.length - 1];
    if (!previous || (anchor.origin > previous.origin && anchor.result > previous.result))
      ordered.push(anchor);
  }
  return anchors.length || isPdf ? [endpoints[0], ...ordered, endpoints[1]] : [];
}

/** 在相邻块锚点间插值并限制在当前结果范围；反向映射复用同一组锚点。 */
export function imageParseMappedProgress(
  anchors: readonly Anchor[],
  progress: number,
  from: 'origin' | 'result',
): number {
  const to = from === 'origin' ? 'result' : 'origin';
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  const scoped = first?.result === 0 && last?.result === 1 && first.origin <= last.origin;
  const start: Anchor = scoped ? first : { origin: 0, result: 0 };
  const end: Anchor = scoped ? last : { origin: 1, result: 1 };
  const inside = anchors.filter(
    (anchor) =>
      internal(anchor) && anchor.origin > start.origin && anchor.origin < end.origin,
  );
  const points = [start, ...inside, end];
  const value = bounded(progress);
  if (value <= start[from]) return start[to];
  if (value >= end[from]) return end[to];
  const exact = inside.find((anchor) => Math.abs(anchor[from] - value) < 0.0001);
  if (exact) return exact[to];
  for (let index = 1; index < points.length; index++) {
    const left = points[index - 1];
    const right = points[index];
    if (value <= right[from] && right[from] > left[from]) {
      const ratio = (value - left[from]) / (right[from] - left[from]);
      return bounded(left[to] + ratio * (right[to] - left[to]));
    }
  }
  return end[to];
}
