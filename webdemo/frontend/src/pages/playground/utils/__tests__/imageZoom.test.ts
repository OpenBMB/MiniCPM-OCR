/**
 * 图片视图几何单测：光标锚点缩放、平移夹紧、旋转贴合、transform 拼装顺序。
 */

import { describe, expect, it } from 'vitest';
import {
  FIT_SCALE,
  INITIAL_VIEW,
  MAX_SCALE,
  MIN_SCALE,
  anchorFromCenter,
  buttonScale,
  clampDocumentView,
  clampView,
  documentScrollProgress,
  fitFactor,
  focusBlockView,
  fitWidthView,
  imageRasterView,
  isTransformed,
  panBy,
  resetZoom,
  rotateView,
  scaleTo,
  viewBounds,
  viewAtDocumentProgress,
  viewTransform,
  type ImageZoomView,
} from '../imageZoom';

/** 800×600 视口里放一张 800×600 的图，scale=1 正好铺满。 */
const VIEWPORT = { width: 800, height: 600 };
const CONTENT = { width: 800, height: 600 };

function view(patch: Partial<ImageZoomView>): ImageZoomView {
  return { ...INITIAL_VIEW, ...patch };
}

describe('原图绘制尺寸', () => {
  it('以最终尺寸绘制原图，平移与旋转不再二次放大图片和框线', () => {
    const raster = imageRasterView(
      view({ scale: 2, offset: { x: 35, y: -20 }, rotation: 90 }),
      VIEWPORT,
      CONTENT,
    );
    expect(raster.width).toBe(1200);
    expect(raster.height).toBe(900);
    expect(raster.transform).toBe('translate(35px, -20px) rotate(90deg)');
  });

  it('适合宽度时铺满横向视口，长文档从顶部开始显示', () => {
    const portrait = { width: 300, height: 600 };
    const next = fitWidthView(view({ offset: { x: 200, y: -100 } }), VIEWPORT, portrait);
    const raster = imageRasterView(next, VIEWPORT, portrait);
    expect(raster.width).toBeCloseTo(800);
    expect(raster.height).toBeCloseTo(1600);
    expect(next.offset.x).toBe(0);
    expect(next.offset.y).toBeCloseTo(500);
  });

  it('旋转后的适合宽度使用旋转包围盒，不改变旋转方向', () => {
    const next = fitWidthView(view({ rotation: 90 }), VIEWPORT, { width: 300, height: 600 });
    const raster = imageRasterView(next, VIEWPORT, { width: 300, height: 600 });
    expect(raster.height).toBeCloseTo(800);
    expect(next.rotation).toBe(90);
    expect(next.offset).toEqual({ x: 0, y: -100 });
  });

  it('尚未测得尺寸时不改变当前视图', () => {
    expect(fitWidthView(INITIAL_VIEW, { width: 0, height: 0 }, CONTENT)).toBe(INITIAL_VIEW);
  });
});

describe('bounded document reading', () => {
  const document = { width: 800, height: 1600 };

  it('should never expose blank space when panning a long document', () => {
    const next = clampDocumentView(view({ offset: { x: 9000, y: -9000 } }), VIEWPORT, document);
    expect(next.offset).toEqual({ x: 0, y: -500 });
    expect(documentScrollProgress(next, VIEWPORT, document)).toBe(1);
  });

  it('should allow horizontal pan only when the drawn width exceeds the viewport', () => {
    const next = clampDocumentView(
      view({ scale: 2, offset: { x: -9000, y: 9000 } }),
      VIEWPORT,
      document,
    );
    expect(next.offset).toEqual({ x: -400, y: 1300 });
  });

  it('should top-align a short fit-width image without allowing extra pan', () => {
    const short = { width: 800, height: 400 };
    const next = fitWidthView(INITIAL_VIEW, VIEWPORT, short);
    expect(next.offset).toEqual({ x: 0, y: -100 });
    expect(clampDocumentView(panBy(next, 50, 50), VIEWPORT, short)).toEqual(next);
    expect(documentScrollProgress(next, VIEWPORT, short)).toBe(0);
  });

  it('should clamp progress inputs and round-trip a requested progress', () => {
    for (const progress of [0, 0.25, 0.5, 1]) {
      const next = viewAtDocumentProgress(INITIAL_VIEW, VIEWPORT, document, progress);
      expect(documentScrollProgress(next, VIEWPORT, document)).toBeCloseTo(progress);
    }
    expect(
      documentScrollProgress(
        viewAtDocumentProgress(INITIAL_VIEW, VIEWPORT, document, 99),
        VIEWPORT,
        document,
      ),
    ).toBe(1);
    expect(viewAtDocumentProgress(INITIAL_VIEW, VIEWPORT, document, Number.NaN).offset.y).toBe(500);
  });

  it('should clamp a focused edge block without blank margins', () => {
    const focused = focusBlockView(
      { x: 0.95, y: 0.95, w: 0.05, h: 0.05 },
      INITIAL_VIEW,
      VIEWPORT,
      document,
    );
    expect(focused.scale).toBe(1);
    expect(Math.abs(focused.offset.x)).toBe(0);
    expect(focused.offset.y).toBe(-500);
  });
});

describe('scaleTo', () => {
  it('keeps the cursor anchor fixed while zooming', () => {
    // 锚点相对视口中心 (100, 50)，放大到 2 倍后该点在屏幕上不该移动。
    const anchor = { x: 100, y: 50 };
    const next = scaleTo(INITIAL_VIEW, 2, anchor);
    // 锚点的屏幕位置 = offset + scale * 内容坐标；内容坐标在缩放前后相同。
    const before = (anchor.x - INITIAL_VIEW.offset.x) / INITIAL_VIEW.scale;
    const after = (anchor.x - next.offset.x) / next.scale;
    expect(after).toBeCloseTo(before, 6);
    expect(next.offset).toEqual({ x: -100, y: -50 });
  });

  it('clamps to the scale range and keeps the anchor fixed on the way out', () => {
    expect(scaleTo(INITIAL_VIEW, 99, null).scale).toBe(MAX_SCALE);
    const zoomed = view({ scale: 3, offset: { x: 40, y: 20 } });
    const anchor = { x: 10, y: 10 };
    const back = scaleTo(zoomed, 0.1, anchor);
    expect(back.scale).toBe(MIN_SCALE);
    // 缩小时不把平移归零：拖到一边的图应停在原处，只是锚点跟着换算。
    expect(back.offset.x).toBeCloseTo(12.5, 6);
    expect((anchor.x - back.offset.x) / back.scale).toBeCloseTo(
      (anchor.x - zoomed.offset.x) / zoomed.scale,
      6,
    );
  });

  it('allows zooming below the fit scale so a long page fits at a glance', () => {
    expect(MIN_SCALE).toBeLessThan(FIT_SCALE);
    expect(scaleTo(INITIAL_VIEW, 0.5, null).scale).toBe(0.5);
  });

  it('returns the same object when the scale does not change', () => {
    expect(scaleTo(INITIAL_VIEW, FIT_SCALE, { x: 5, y: 5 })).toBe(INITIAL_VIEW);
  });
});

describe('buttonScale', () => {
  it('按 25% 一档缩放，缩到下限后能逐档回到 100%', () => {
    expect(buttonScale(1, 1)).toBe(1.25);
    expect(buttonScale(1, -1)).toBe(0.75);
    let scale = 0.25;
    for (let step = 0; step < 3; step += 1) scale = buttonScale(scale, 1);
    expect(scale).toBe(1);
    expect(buttonScale(0.25, -1)).toBe(0.25);
    expect(buttonScale(6, 1)).toBe(6);
  });

  it('滚轮停在两档之间时先回到最近的网格', () => {
    expect(buttonScale(0.9, 1)).toBe(1);
    expect(buttonScale(0.9, -1)).toBe(0.75);
  });
});

describe('viewBounds / clampView', () => {
  it('lets a fitting image be dragged aside, keeping 48px on screen', () => {
    // 贴合状态下也有余量：(视口 + 包围盒) / 2 - 48，所以「按住拖不动」不会再发生。
    expect(viewBounds(INITIAL_VIEW, VIEWPORT, CONTENT)).toEqual({ x: 752, y: 552 });
    const dragged = clampView(panBy(INITIAL_VIEW, 120, -80), VIEWPORT, CONTENT);
    expect(dragged.offset).toEqual({ x: 120, y: -80 });
  });

  it('only clamps once the image is nearly off screen', () => {
    const bounds = viewBounds(view({ scale: 2 }), VIEWPORT, CONTENT);
    expect(bounds).toEqual({ x: 1152, y: 852 });
    const clamped = clampView(view({ scale: 2, offset: { x: 9000, y: -9000 } }), VIEWPORT, CONTENT);
    expect(clamped.offset).toEqual({ x: 1152, y: -852 });
  });

  it('keeps a dragged-aside image in place when zooming in', () => {
    // 「拖到一边再放大盯着看」是核对常规动作，缩放不该把偏移吃掉。
    const dragged = view({ offset: { x: 300, y: -200 } });
    const zoomed = clampView(scaleTo(dragged, 2, null), VIEWPORT, CONTENT);
    expect(zoomed.offset).toEqual({ x: 300, y: -200 });
  });

  it('swaps width and height on a quarter turn', () => {
    // 竖图 600×800 转 90°，包围盒变 800×600，余量与横图贴合时一致。
    const bounds = viewBounds(view({ rotation: 90 }), VIEWPORT, { width: 600, height: 800 });
    expect(bounds).toEqual({ x: 752, y: 552 });
  });

  it('treats unmeasured sizes as unbounded so panning is not falsely disabled', () => {
    const bounds = viewBounds(view({ scale: 2 }), { width: 0, height: 0 }, CONTENT);
    expect(bounds.x).toBe(Infinity);
  });
});

describe('fitFactor', () => {
  it('is 1 without rotation', () => {
    expect(fitFactor(0, VIEWPORT, CONTENT)).toBe(1);
    expect(fitFactor(180, VIEWPORT, CONTENT)).toBe(1);
  });

  it('shrinks a landscape image so a quarter turn still fits', () => {
    // 800×600 的图转 90° 后占 600×800，高度超出 600，需要缩到 0.75。
    expect(fitFactor(90, VIEWPORT, CONTENT)).toBeCloseTo(0.75, 6);
    expect(fitFactor(270, VIEWPORT, CONTENT)).toBeCloseTo(0.75, 6);
  });
});

describe('focusBlockView', () => {
  it('centers the chosen region without changing the current zoom', () => {
    const focused = focusBlockView(
      { x: 0.7, y: 0.2, w: 0.1, h: 0.1 },
      INITIAL_VIEW,
      VIEWPORT,
      CONTENT,
    );
    expect(focused.scale).toBe(1);
    expect(focused.offset.x).toBeCloseTo(0);
    expect(focused.offset.y).toBeCloseTo(0);
  });

  it('uses rotated coordinates and keeps the existing higher zoom', () => {
    const focused = focusBlockView(
      { x: 0.7, y: 0.2, w: 0.1, h: 0.1 },
      view({ scale: 2, rotation: 90 }),
      VIEWPORT,
      CONTENT,
    );
    expect(focused.scale).toBe(2);
    expect(focused.offset.x).toBeCloseTo(-50);
    expect(focused.offset.y).toBeCloseTo(-300);
  });
});

describe('rotateView / resetZoom / isTransformed', () => {
  it('rotates in 90 degree steps and wraps at 360', () => {
    expect(rotateView(view({ rotation: 270 })).rotation).toBe(0);
  });

  it('rotates counter-clockwise without producing a negative angle', () => {
    expect(rotateView(INITIAL_VIEW, -1).rotation).toBe(270);
    expect(rotateView(view({ rotation: 90 }), -1).rotation).toBe(0);
  });

  it('keeps the rotation when resetting the zoom', () => {
    const reset = resetZoom(view({ scale: 3, offset: { x: 10, y: 10 }, rotation: 90 }));
    expect(reset).toEqual({ scale: FIT_SCALE, offset: { x: 0, y: 0 }, rotation: 90 });
  });

  it('reports the initial view as untransformed', () => {
    expect(isTransformed(INITIAL_VIEW)).toBe(false);
    expect(isTransformed(view({ rotation: 90 }))).toBe(true);
    expect(isTransformed(view({ offset: { x: 1, y: 0 } }))).toBe(true);
    // 缩到贴合以下也算动过，否则「还原」按钮会在缩小状态下变灰。
    expect(isTransformed(view({ scale: MIN_SCALE }))).toBe(true);
  });
});

describe('viewTransform', () => {
  it('puts translate outermost so panning stays in screen space', () => {
    const css = viewTransform(view({ scale: 2, offset: { x: 30, y: -40 } }), VIEWPORT, CONTENT);
    expect(css).toBe('translate(30px, -40px) scale(2) rotate(0deg)');
  });

  it('folds the rotation fit factor into the scale', () => {
    const css = viewTransform(view({ rotation: 90 }), VIEWPORT, CONTENT);
    expect(css).toBe('translate(0px, 0px) scale(0.75) rotate(90deg)');
  });
});

describe('anchorFromCenter', () => {
  it('returns the cursor offset from the viewport center', () => {
    const rect = { left: 100, top: 50, width: 800, height: 600 } as DOMRect;
    expect(anchorFromCenter({ clientX: 500, clientY: 350 }, rect)).toEqual({ x: 0, y: 0 });
    expect(anchorFromCenter({ clientX: 600, clientY: 350 }, rect)).toEqual({ x: 100, y: 0 });
  });

  it('returns null before the viewport is measured', () => {
    expect(anchorFromCenter({ clientX: 10, clientY: 10 }, undefined)).toBeNull();
    expect(anchorFromCenter({ clientX: 10, clientY: 10 }, { width: 0 } as DOMRect)).toBeNull();
  });
});
