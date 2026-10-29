import { imageParseBlockId } from './imageParseBlocks';
import type {
  ImageParseLayoutBlock,
  ImageParseLayoutRegion,
  ImageParseRotationInfo,
} from './imageParseSample';

/**
 * 按顺时针 90 度步长旋转一个归一化矩形。
 * @param region 原坐标系中的矩形
 * @param angle 已归一化的顺时针角度
 * @returns 旋转后坐标系中的矩形
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
 * 将原图归一化坐标投影到顺时针旋转后的页面，不修改识别数据。
 * @param blocks 原图方向的识别块，已包含 PDF 自带旋转的影响
 * @param rotation 工具栏额外旋转角度，以 90 度为步长
 * @returns 预览坐标和稳定标识，分数及内容保持不变
 */
export function rotateImageParseBlocks(
  blocks: readonly ImageParseLayoutBlock[],
  rotation: number,
): readonly ImageParseLayoutBlock[] {
  const angle = ((rotation % 360) + 360) % 360;
  if (angle === 0) return blocks;
  const direction = angle as 90 | 180 | 270;
  return blocks.map((block, order) => {
    // 无服务标识的块必须沿用原始坐标生成的 ID，否则旋转会断开结果定位。
    const original = { ...block, id: imageParseBlockId(block, order) };
    return {
      ...original,
      ...rotateRegion(block, direction),
      // PDF 原方向恢复必须连同 regions 投影，否则合并块仍会画在服务端摆正坐标。
      ...(block.regions?.length
        ? { regions: block.regions.map((region) => rotateRegion(region, direction)) }
        : {}),
    };
  });
}

/**
 * 将服务端摆正后的 PDF 坐标投回原始页面方向。
 * @param blocks 服务端摆正坐标系中的识别块
 * @param rotation 服务端旋转元数据
 * @returns 原始 PDF 预览方向中的识别块；未摆正时复用原数组
 */
export function restoreImageParseBlocksToOriginal(
  blocks: readonly ImageParseLayoutBlock[],
  rotation: ImageParseRotationInfo | undefined,
): readonly ImageParseLayoutBlock[] {
  if (!rotation?.enabled || !rotation.applied) return blocks;
  return rotateImageParseBlocks(blocks, -rotation.orientationAngle);
}

/**
 * 这一页预览要转回摆正方向的角度。
 * 单图用 totalAngle 直接转原图；PDF 的框已经按 orientationAngle 投回原页，页面必须转同一个角度，框才会跟着落在文字上。
 */
export function imageParseServerDisplayAngle(rotation: ImageParseRotationInfo | undefined): number {
  if (!rotation?.enabled || !rotation.applied || !Number.isFinite(rotation.orientationAngle))
    return 0;
  const turns = ((rotation.orientationAngle % 360) + 360) % 360;
  return turns === 0 ? 0 : rotation.orientationAngle;
}

/** 原页面绕中心旋转后的外接矩形。0° 和 180° 的占位尺寸不变。 */
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
