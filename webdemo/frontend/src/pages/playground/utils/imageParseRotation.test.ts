import { describe, expect, it } from 'vitest';
import { imageParseBlockId } from './imageParseBlocks';
import {
  imageParseServerDisplayAngle,
  restoreImageParseBlocksToOriginal,
  rotatedPageBounds,
  rotateImageParseBlocks,
} from './imageParseRotation';
import type { ImageParseLayoutBlock, ImageParseRotationInfo } from './imageParseSample';

const block: ImageParseLayoutBlock = Object.freeze({
  id: 'server-block',
  order: 4,
  kind: 'table',
  x: 0.1,
  y: 0.2,
  w: 0.3,
  h: 0.4,
  confidence: 0.795,
  text: 'original',
  markdown: '| original |',
  markdownStart: 0,
  markdownEnd: 12,
  status: 'ok',
});

describe('rotateImageParseBlocks', () => {
  it.each([90, 180, 270])('旋转 %i 度只改变坐标，保留服务标识、分数和识别内容', (angle) => {
    const result = rotateImageParseBlocks([block], angle)[0]!;
    const { x, y, w, h, ...metadata } = result;
    const { x: _x, y: _y, w: _w, h: _h, ...originalMetadata } = block;
    expect(metadata).toEqual(originalMetadata);
    expect([x, y, w, h]).not.toEqual([block.x, block.y, block.w, block.h]);
  });

  it('无旋转时复用原数组，负角度与多圈旋转投影到同一方向', () => {
    const blocks = Object.freeze([block]);
    expect(rotateImageParseBlocks(blocks, 0)).toBe(blocks);
    expect(rotateImageParseBlocks(blocks, 360)).toBe(blocks);
    expect(rotateImageParseBlocks(blocks, -90)).toEqual(rotateImageParseBlocks(blocks, 270));
    expect(rotateImageParseBlocks(blocks, 450)).toEqual(rotateImageParseBlocks(blocks, 90));
  });

  it('页面四角的块始终在边界内，无标识块定位沿用原图 ID', () => {
    const blocks = [
      { ...block, id: undefined, x: 0, y: 0, w: 0.1, h: 0.2 },
      { ...block, id: undefined, x: 0.9, y: 0, w: 0.1, h: 0.2 },
      { ...block, id: undefined, x: 0, y: 0.8, w: 0.1, h: 0.2 },
      { ...block, id: undefined, x: 0.9, y: 0.8, w: 0.1, h: 0.2 },
    ];
    for (const angle of [90, 180, 270]) {
      rotateImageParseBlocks(blocks, angle).forEach((result, index) => {
        expect(result.id).toBe(imageParseBlockId(blocks[index]!, index));
        expect(result.x).toBeGreaterThanOrEqual(-Number.EPSILON);
        expect(result.y).toBeGreaterThanOrEqual(-Number.EPSILON);
        expect(result.x + result.w).toBeLessThanOrEqual(1 + Number.EPSILON);
        expect(result.y + result.h).toBeLessThanOrEqual(1 + Number.EPSILON);
      });
    }
  });
});

describe('restoreImageParseBlocksToOriginal', () => {
  it('把服务端摆正后的 PDF 坐标投回原方向，未摆正时复用原数组', () => {
    const blocks = Object.freeze([block]);
    const rotation: ImageParseRotationInfo = {
      enabled: true,
      applied: true,
      totalAngle: 89.58,
      predictedAngle: 90,
      predictedScore: 0.97,
      confirmed: true,
      orientationAngle: 90,
      deskewAngle: -0.42,
      skippedReason: null,
    };

    expect(restoreImageParseBlocksToOriginal(blocks, rotation)).toEqual(
      rotateImageParseBlocks(blocks, -90),
    );
    expect(restoreImageParseBlocksToOriginal(blocks, { ...rotation, applied: false })).toBe(blocks);
  });

  it('投回 PDF 原方向时同步旋转 regions，避免合并表格仍画在服务端坐标', () => {
    const merged = {
      ...block,
      bbox: undefined,
      regions: [
        { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
        { x: 0.5, y: 0.1, w: 0.2, h: 0.1 },
      ],
    } as ImageParseLayoutBlock;
    const rotation: ImageParseRotationInfo = {
      enabled: true,
      applied: true,
      totalAngle: 89.58,
      predictedAngle: 90,
      predictedScore: 0.97,
      confirmed: true,
      orientationAngle: 90,
      deskewAngle: -0.42,
      skippedReason: null,
    };

    const restoredRegions = restoreImageParseBlocksToOriginal([merged], rotation)[0]!.regions!;
    expect(restoredRegions.map(({ x, y, w, h }) => [x, y, w, h])).toEqual([
      [0.2, 1 - 0.1 - 0.3, 0.4, 0.3],
      [0.1, 1 - 0.5 - 0.2, 0.1, 0.2],
    ]);
    expect(restoredRegions[0]!.y).toBeCloseTo(0.6, 15);
    expect(restoredRegions[1]!.y).toBeCloseTo(0.3, 15);
  });
});

describe('imageParseServerDisplayAngle', () => {
  const rotation: ImageParseRotationInfo = {
    enabled: true,
    applied: true,
    totalAngle: 89.58,
    predictedAngle: 90,
    predictedScore: 0.97,
    confirmed: true,
    orientationAngle: 90,
    deskewAngle: -0.42,
    skippedReason: null,
  };

  it('用这一页自己的摆正角度，未摆正时不转', () => {
    expect(imageParseServerDisplayAngle(rotation)).toBe(90);
    expect(imageParseServerDisplayAngle({ ...rotation, applied: false })).toBe(0);
    expect(imageParseServerDisplayAngle({ ...rotation, enabled: false })).toBe(0);
    expect(imageParseServerDisplayAngle({ ...rotation, orientationAngle: 360 })).toBe(0);
    expect(imageParseServerDisplayAngle(undefined)).toBe(0);
  });
});

describe('rotatedPageBounds', () => {
  it('90 度交换宽高，180 度占位不变', () => {
    const quarter = rotatedPageBounds(100, 240, 90);
    expect(quarter.width).toBeCloseTo(240);
    expect(quarter.height).toBeCloseTo(100);
    const negative = rotatedPageBounds(100, 240, -90);
    expect(negative.width).toBeCloseTo(240);
    expect(negative.height).toBeCloseTo(100);
    expect(rotatedPageBounds(100, 240, 180)).toEqual({ width: 100, height: 240 });
    expect(rotatedPageBounds(100, 240, 0)).toEqual({ width: 100, height: 240 });
  });
});
