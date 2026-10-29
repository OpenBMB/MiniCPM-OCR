import { imageParseBlockId } from './imageParseBlocks';
import { rotateImageParseBlocks } from './imageParseRotation';
import type { ImageParseLayoutBlock } from './imageParseSample';

const bounded = (value: number) => Math.max(0, Math.min(1, value));

/** 连续 PDF 按页面骨架映射全篇，当前页再用真实区块细化；离屏页仍可定位。 */
export function imageParsePdfScrollAnchors(
  origin: HTMLElement,
  result: HTMLElement,
  blocks: readonly ImageParseLayoutBlock[],
) {
  const originRange = Math.max(0, origin.scrollHeight - origin.clientHeight);
  const resultRange = Math.max(0, result.scrollHeight - result.clientHeight);
  if (!originRange || !resultRange) return [];
  const originTop = origin.getBoundingClientRect().top;
  const resultTop = result.getBoundingClientRect().top;
  const currentPage = Number(origin.dataset.pdfCurrentPage);
  const rotated = rotateImageParseBlocks(blocks, Number(origin.dataset.pdfRotation ?? 0));
  const anchors: Array<{ origin: number; result: number }> = [];
  result.querySelectorAll<HTMLElement>('[data-ocr-result-page]').forEach((section) => {
    const number = Number(section.dataset.ocrResultPage);
    const page = origin.querySelector<HTMLElement>(`[data-pdf-page="${number}"]`);
    if (!page) return;
    const original = page.getBoundingClientRect();
    const rendered = section.getBoundingClientRect();
    if (!original.height || !rendered.height) return;
    const offset = original.top - originTop + origin.scrollTop - origin.clientHeight / 2;
    const resultOffset = rendered.top - resultTop + result.scrollTop - result.clientHeight / 2;
    anchors.push(
      { origin: bounded(offset / originRange), result: bounded(resultOffset / resultRange) },
      {
        origin: bounded((offset + original.height) / originRange),
        result: bounded((resultOffset + rendered.height) / resultRange),
      },
    );
    if (number !== currentPage) return;
    const positions = new Map<string, number>();
    section.querySelectorAll<HTMLElement>('[data-ocr-linked-ids]').forEach((node) => {
      if (node.closest('[data-visual-editing="true"]')) return;
      const rect = node.getBoundingClientRect();
      if (!rect.height) return;
      const ids: unknown = JSON.parse(node.dataset.ocrLinkedIds ?? '[]');
      if (!Array.isArray(ids)) return;
      for (const id of ids) {
        if (typeof id === 'string' && !positions.has(id))
          positions.set(
            id,
            bounded(
              (rect.top - resultTop + result.scrollTop - result.clientHeight / 2) / resultRange,
            ),
          );
      }
    });
    rotated.forEach((block, index) => {
      const position = positions.get(imageParseBlockId(block, index));
      if (position !== undefined)
        anchors.push({
          origin: bounded((offset + block.y * original.height) / originRange),
          result: position,
        });
    });
  });
  anchors.sort((left, right) => left.origin - right.origin || left.result - right.result);
  const ordered = [{ origin: 0, result: 0 }];
  for (const anchor of anchors) {
    const previous = ordered[ordered.length - 1];
    if (
      anchor.origin > previous.origin && anchor.result > previous.result &&
      anchor.origin < 1 && anchor.result < 1
    )
      ordered.push(anchor);
  }
  return [...ordered, { origin: 1, result: 1 }];
}
