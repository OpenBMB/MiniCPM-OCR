/**
 * Pure geometry for the image view (zoom / pan / rotation).
 *
 * Document reading uses a strict boundary and top alignment; clampView keeps the old geometry contract of fullscreen preview.
 * The transform is translate → scale → rotate: translate is written outermost,
 * so pan is in screen coordinates and is "drag one pixel, move one pixel" at any scale and any angle.
 */

import type { ImageZoomView, Point, Size } from './imageZoomTypes';

export type { ImageZoomView, Point, Size } from './imageZoomTypes';

/**
 * Zoom range and step.
 * FIT_SCALE=1 is the layout baseline; MIN_SCALE allows zooming out to see the whole image, and the 6x cap is for checking small text.
 */
export const FIT_SCALE = 1;
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 6;
/** Step for each button zoom. 25% per step, so after zooming to the floor it can still return to 100% step by step. */
export const BUTTON_STEP = 0.25;
/** Coefficient from wheel pixels to zoom ratio. */
export const WHEEL_STEP = 0.0015;
/** Scale a double-click zooms to. */
export const DOUBLE_CLICK_SCALE = 2.5;
/** No matter how it is dragged, the image must leave at least this many pixels inside the viewport, or it really cannot be found again. */
const KEEP_VISIBLE = 48;

export const INITIAL_VIEW: ImageZoomView = {
  scale: FIT_SCALE,
  offset: { x: 0, y: 0 },
  rotation: 0,
};

/** Whether the angle is 90° / 270°, when content width and height are swapped on screen. */
export function isQuarterTurn(rotation: number): boolean {
  return rotation % 180 !== 0;
}

export function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

/** Button zoom snaps to a 25% grid, so zooming back in after 25% does not skip 100%. */
export function buttonScale(current: number, direction: 1 | -1): number {
  const steps = current / BUTTON_STEP;
  const nearest = Math.round(steps);
  const onGrid = Math.abs(current - nearest * BUTTON_STEP) < 1e-4;
  const next = onGrid
    ? nearest + direction
    : direction > 0
      ? Math.floor(steps) + 1
      : Math.ceil(steps) - 1;
  return clampScale(next * BUTTON_STEP);
}

function clampAbs(value: number, max: number): number {
  return Math.min(max, Math.max(-max, value));
}

/**
 * Rotation fit factor; keeps the bounding box from exceeding the viewport, and returns 1 when size has not been measured.
 * @param rotation current angle
 * @param viewport viewport size
 * @param content layout size of the content before transform
 */
export function fitFactor(rotation: number, viewport: Size, content: Size): number {
  if (!isQuarterTurn(rotation) || !viewport.width || !content.width || !content.height) return 1;
  return Math.min(1, viewport.width / content.height, viewport.height / content.width);
}

/** Bounding box of the transformed content on screen. Width and height swap at 90°. */
function contentBox(view: ImageZoomView, viewport: Size, content: Size): Size {
  const effective = view.scale * fitFactor(view.rotation, viewport, content);
  const quarter = isQuarterTurn(view.rotation);
  return {
    width: (quarter ? content.height : content.width) * effective,
    height: (quarter ? content.width : content.height) * effective,
  };
}

/** Reading mode forbids dragging past the image edge; a short image stays top-aligned, and is centered when it is narrower than the viewport. */
export function clampDocumentView(
  view: ImageZoomView,
  viewport: Size,
  content: Size,
): ImageZoomView {
  if (!viewport.width || !viewport.height || !content.width || !content.height) return view;
  const box = contentBox(view, viewport, content);
  const x = clampAbs(view.offset.x, Math.max(0, (box.width - viewport.width) / 2));
  const y =
    box.height <= viewport.height
      ? (box.height - viewport.height) / 2
      : clampAbs(view.offset.y, (box.height - viewport.height) / 2);
  if (x === view.offset.x && y === view.offset.y) return view;
  return { ...view, offset: { x, y } };
}

/** Fraction of the document's vertical position within the scrollable range, used to link the two columns. */
export function documentScrollProgress(view: ImageZoomView, viewport: Size, content: Size): number {
  if (!viewport.height || !content.height) return 0;
  const max = Math.max(0, (contentBox(view, viewport, content).height - viewport.height) / 2);
  return max ? Math.max(0, Math.min(1, (max - view.offset.y) / (max * 2))) : 0;
}

/** Map the result column's scroll fraction to the image's vertical pan. */
export function viewAtDocumentProgress(
  view: ImageZoomView,
  viewport: Size,
  content: Size,
  progress: number,
): ImageZoomView {
  const max = Math.max(0, (contentBox(view, viewport, content).height - viewport.height) / 2);
  const bounded = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  return clampDocumentView(
    {
      ...view,
      offset: { ...view.offset, y: max * (1 - 2 * bounded) },
    },
    viewport,
    content,
  );
}
/** Content pixels that must stay inside the viewport at all times; when the content or the viewport itself is very small, yield to half. */
function keepVisible(contentSpan: number, viewportSpan: number): number {
  return Math.min(KEEP_VISIBLE, contentSpan / 2, viewportSpan / 2);
}

/**
 * Old pan limit for fullscreen preview: keep at least KEEP_VISIBLE pixels; when unmeasured, set no limit.
 * @param view current view
 * @param viewport viewport size
 * @param content layout size of the content before transform
 * @returns absolute upper bound of pan on both axes
 */
export function viewBounds(view: ImageZoomView, viewport: Size, content: Size): Point {
  if (!viewport.width || !content.width) return { x: Infinity, y: Infinity };
  const box = contentBox(view, viewport, content);
  return {
    x: Math.max(0, (viewport.width + box.width) / 2 - keepVisible(box.width, viewport.width)),
    y: Math.max(0, (viewport.height + box.height) / 2 - keepVisible(box.height, viewport.height)),
  };
}

/** Clamp pan back inside the limit, so the image cannot be dragged out of the viewport and lost. */
export function clampView(view: ImageZoomView, viewport: Size, content: Size): ImageZoomView {
  const bounds = viewBounds(view, viewport, content);
  const x = clampAbs(view.offset.x, bounds.x);
  const y = clampAbs(view.offset.y, bounds.y);
  if (x === view.offset.x && y === view.offset.y) return view;
  return { ...view, offset: { x, y } };
}

/**
 * Compute the view after a zoom.
 * When anchor is given, that point stays still on screen — the wheel anchors on the cursor, so the text you zoomed in to read is not pushed out of the viewport;
 * button zoom passes null and anchors on the viewport center.
 * @param view current view
 * @param next target scale, clamped to [MIN_SCALE, MAX_SCALE]
 * @param anchor anchor offset relative to the viewport center; null means the anchor is the center
 */
export function scaleTo(view: ImageZoomView, next: number, anchor: Point | null): ImageZoomView {
  const scale = clampScale(next);
  if (scale === view.scale) return view;
  // When the anchor is the center, pan does not need to move: the center point does not move with zoom anyway.
  if (!anchor) return { ...view, scale };
  const ratio = 1 - scale / view.scale;
  return {
    ...view,
    scale,
    offset: {
      x: view.offset.x + ratio * (anchor.x - view.offset.x),
      y: view.offset.y + ratio * (anchor.y - view.offset.y),
    },
  };
}

/**
 * Anchor conversion: turn screen coordinates into "offset relative to the viewport center", the anchor scaleTo wants.
 * @param point screen coordinates (WheelEvent and MouseEvent both qualify)
 * @param rect viewport rectangle; when unavailable, return null to mean the anchor is the center
 */
export function anchorFromCenter(
  point: { clientX: number; clientY: number },
  rect?: DOMRect,
): Point | null {
  if (!rect?.width) return null;
  return {
    x: point.clientX - (rect.left + rect.width / 2),
    y: point.clientY - (rect.top + rect.height / 2),
  };
}

/** Pan. dx/dy are screen deltas and are added directly, so it follows the hand 1:1. */
export function panBy(view: ImageZoomView, dx: number, dy: number): ImageZoomView {
  return { ...view, offset: { x: view.offset.x + dx, y: view.offset.y + dy } };
}

/**
 * Center the recognition block in normalized original-image coordinates; after rotation, convert pan in screen coordinates.
 * @param block recognition-block coordinates
 * @param view current zoom and rotation
 * @param viewport viewport size
 * @param content layout size of the image
 */
export function focusBlockView(
  block: { x: number; y: number; w: number; h: number },
  view: ImageZoomView,
  viewport: Size,
  content: Size,
): ImageZoomView {
  if (!viewport.width || !content.width) return view;
  const scale = view.scale;
  const effective = scale * fitFactor(view.rotation, viewport, content);
  const x = (block.x + block.w / 2 - 0.5) * content.width * effective;
  const y = (block.y + block.h / 2 - 0.5) * content.height * effective;
  const radians = (view.rotation * Math.PI) / 180;
  return clampDocumentView(
    {
      ...view,
      scale,
      offset: {
        x: -(x * Math.cos(radians) - y * Math.sin(radians)),
        y: -(x * Math.sin(radians) + y * Math.cos(radians)),
      },
    },
    viewport,
    content,
  );
}

/**
 * Draw the original image at the final layout size; the transform handles only pan and rotation, and box strokes and numbers keep a fixed size.
 * @param view current view
 * @param viewport viewport size
 * @param content unscaled layout size of the image
 */
export function imageRasterView(view: ImageZoomView, viewport: Size, content: Size) {
  const factor = view.scale * fitFactor(view.rotation, viewport, content);
  return {
    width: content.width * factor,
    height: content.height * factor,
    transform: `translate(${round(view.offset.x)}px, ${round(view.offset.y)}px) rotate(${view.rotation}deg)`,
  };
}

/**
 * Fit the image's width to the viewport after rotation; a long image starts at the top, and can be dragged later to check it.
 * @param view current view
 * @param viewport viewport size
 * @param content unscaled layout size of the image
 */
export function fitWidthView(view: ImageZoomView, viewport: Size, content: Size): ImageZoomView {
  if (!viewport.width || !content.width || !content.height) return view;
  const quarter = isQuarterTurn(view.rotation);
  const width = quarter ? content.height : content.width;
  const scale = clampScale(viewport.width / (width * fitFactor(view.rotation, viewport, content)));
  const next = { ...view, scale };
  const box = contentBox(next, viewport, content);
  return clampDocumentView(
    {
      ...next,
      offset: { x: 0, y: (box.height - viewport.height) / 2 },
    },
    viewport,
    content,
  );
}

/**
 * @param view current view
 * @param direction 1 clockwise, -1 counterclockwise
 */
export function rotateView(view: ImageZoomView, direction: 1 | -1 = 1): ImageZoomView {
  // Add 360 before the modulo, so counterclockwise does not compute -90 at 0°.
  return { ...view, rotation: (view.rotation + 360 + 90 * direction) % 360 };
}

/** Restore only zoom and pan, and keep the angle — used by double-click, so an image whose orientation was corrected is not rotated back as well. */
export function resetZoom(view: ImageZoomView): ImageZoomView {
  return { ...view, scale: FIT_SCALE, offset: { x: 0, y: 0 } };
}

/** Whether the view has left the initial view, used to decide whether to show "Reset". */
export function isTransformed(view: ImageZoomView): boolean {
  return (
    view.scale !== FIT_SCALE || view.rotation !== 0 || view.offset.x !== 0 || view.offset.y !== 0
  );
}

/**
 * Build the CSS transform. The order is explained at the top of the file; changing the order breaks both pan direction and anchor conversion.
 * @param view current view
 * @param viewport viewport size
 * @param content layout size of the content before transform
 */
export function viewTransform(view: ImageZoomView, viewport: Size, content: Size): string {
  const scale = view.scale * fitFactor(view.rotation, viewport, content);
  return `translate(${round(view.offset.x)}px, ${round(view.offset.y)}px) scale(${round(scale, 4)}) rotate(${view.rotation}deg)`;
}

/** Drop floating-point noise, so the style string does not look different every frame. */
function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
