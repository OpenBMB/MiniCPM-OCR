import { imageParseBlockId } from './imageParseBlocks';
import type {
  ImageParseLayoutBlock,
  ImageParseLayoutRegion,
  ImageParseRotationInfo,
} from './imageParseSample';

/**
 * Rotate a normalized rectangle in clockwise 90-degree steps.
 * @param region rectangle in the original coordinate system
 * @param angle normalized clockwise angle
 * @returns rectangle in the rotated coordinate system
 */
function rotateRegion(
  region: ImageParseLayoutRegion,
  angle: 0 | 90 | 180 | 270,
): ImageParseLayoutRegion {
  switch (angle) {
    case 90:
      return { x: 1 - region.y - region.h, y: region.x, w: region.h, h: region.w };
    case 180:
      return { x: 1 - region.x - region.w, y: 1 - region.y - region.h, w: region.w, h: region.h };
    case 270:
      return { x: region.y, y: 1 - region.x - region.w, w: region.h, h: region.w };
    default:
      return region;
  }
}

/**
 * Project normalized coordinates of the original image onto the page after a clockwise rotation, without modifying recognition data.
 * @param blocks recognition blocks in the original-image orientation, already including the PDF's own rotation
 * @param rotation extra toolbar rotation angle, in 90-degree steps
 * @returns preview coordinates and a stable id; score and content stay unchanged
 */
export function rotateImageParseBlocks(
  blocks: readonly ImageParseLayoutBlock[],
  rotation: number,
): readonly ImageParseLayoutBlock[] {
  const angle = ((rotation % 360) + 360) % 360;
  if (angle === 0) return blocks;
  const direction = angle as 90 | 180 | 270;
  return blocks.map((block, order) => {
    // A block with no service id must keep the id generated from the original coordinates, or rotation would disconnect result positioning.
    const original = { ...block, id: imageParseBlockId(block, order) };
    return {
      ...original,
      ...rotateRegion(block, direction),
      // Restoring the PDF's original orientation must project regions as well, or a merged block would still be drawn in server rotation-adaptation coordinates.
      ...(block.regions?.length
        ? { regions: block.regions.map((region) => rotateRegion(region, direction)) }
        : {}),
    };
  });
}

/**
 * Project PDF coordinates after server rotation adaptation back to the original page orientation.
 * @param blocks recognition blocks in the server rotation-adaptation coordinate system
 * @param rotation server rotation metadata
 * @returns recognition blocks in the original PDF preview orientation; reuse the original array when rotation adaptation was not applied
 */
export function restoreImageParseBlocksToOriginal(
  blocks: readonly ImageParseLayoutBlock[],
  rotation: ImageParseRotationInfo | undefined,
): readonly ImageParseLayoutBlock[] {
  if (!rotation?.enabled || !rotation.applied) return blocks;
  return rotateImageParseBlocks(blocks, -rotation.orientationAngle);
}

/**
 * Angle this page's preview must rotate back toward the rotation-adaptation orientation.
 * A single image uses totalAngle to rotate the original directly; PDF boxes have already been projected back to the original page by orientationAngle, so the page must rotate by the same angle for the boxes to land on the text.
 */
export function imageParseServerDisplayAngle(rotation: ImageParseRotationInfo | undefined): number {
  if (!rotation?.enabled || !rotation.applied || !Number.isFinite(rotation.orientationAngle))
    return 0;
  const turns = ((rotation.orientationAngle % 360) + 360) % 360;
  return turns === 0 ? 0 : rotation.orientationAngle;
}

/** Bounding box of the original page after rotation about its center. The placeholder size is unchanged at 0° and 180°. */
export function rotatedPageBounds(
  width: number,
  height: number,
  angle: number,
): { width: number; height: number } {
  if (!Number.isFinite(angle) || angle % 180 === 0) return { width, height };
  const radians = (Math.abs(angle) * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  return { width: width * cosine + height * sine, height: width * sine + height * cosine };
}
