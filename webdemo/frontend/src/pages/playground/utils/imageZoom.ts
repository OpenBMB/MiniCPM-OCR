/**
 * 图片视图（缩放 / 平移 / 旋转）的纯几何换算。
 *
 * 文档阅读使用严格边界与顶部对齐；clampView 保留全屏预览的旧几何契约。
 * transform 约定为 translate → scale → rotate：translate 写在最外层，
 * 平移量落在屏幕坐标系里，任意倍数、任意角度下都是「拖一像素走一像素」。
 */

import type { ImageZoomView, Point, Size } from './imageZoomTypes';

export type { ImageZoomView, Point, Size } from './imageZoomTypes';

/**
 * 缩放区间与步进。
 * FIT_SCALE=1 是布局基准；MIN_SCALE 允许缩小查看全貌，上限 6 倍用于核对小字。
 */
export const FIT_SCALE = 1;
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 6;
/** 按钮每次缩放的步长。25% 一档，缩到下限后仍能逐档回到 100%。 */
export const BUTTON_STEP = 0.25;
/** 滚轮像素 → 缩放比例的系数。 */
export const WHEEL_STEP = 0.0015;
/** 双击放大到的倍数。 */
export const DOUBLE_CLICK_SCALE = 2.5;
/** 无论怎么拖，图至少要留这么多像素在视口里，否则就真找不回来了。 */
const KEEP_VISIBLE = 48;

export const INITIAL_VIEW: ImageZoomView = {
  scale: FIT_SCALE,
  offset: { x: 0, y: 0 },
  rotation: 0,
};

/** 是否为 90° / 270°，此时内容的宽高在屏幕上互换。 */
export function isQuarterTurn(rotation: number): boolean {
  return rotation % 180 !== 0;
}

export function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

/** 按钮缩放对齐到 25% 网格，避免缩到 25% 后再放大时跳过 100%。 */
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
 * 旋转贴合系数；避免包围盒超出视口，未测量到尺寸时返回 1。
 * @param rotation 当前角度
 * @param viewport 视口尺寸
 * @param content 内容未变换时的布局尺寸
 */
export function fitFactor(rotation: number, viewport: Size, content: Size): number {
  if (!isQuarterTurn(rotation) || !viewport.width || !content.width || !content.height) return 1;
  return Math.min(1, viewport.width / content.height, viewport.height / content.width);
}

/** 变换后内容在屏幕上的包围盒。旋转 90° 时宽高互换。 */
function contentBox(view: ImageZoomView, viewport: Size, content: Size): Size {
  const effective = view.scale * fitFactor(view.rotation, viewport, content);
  const quarter = isQuarterTurn(view.rotation);
  return {
    width: (quarter ? content.height : content.width) * effective,
    height: (quarter ? content.width : content.height) * effective,
  };
}

/** 阅读模式禁止拖出图片边界；短图固定顶部对齐，横向不足视口时居中。 */
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

/** 文档纵向位置在可滚动范围内的比例，用于双栏联动。 */
export function documentScrollProgress(view: ImageZoomView, viewport: Size, content: Size): number {
  if (!viewport.height || !content.height) return 0;
  const max = Math.max(0, (contentBox(view, viewport, content).height - viewport.height) / 2);
  return max ? Math.max(0, Math.min(1, (max - view.offset.y) / (max * 2))) : 0;
}

/** 把结果栏的滚动比例映射到图片的竖向平移。 */
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
/** 任何时候都要留在视口里的内容像素；内容或视口本身很小时退让到一半。 */
function keepVisible(contentSpan: number, viewportSpan: number): number {
  return Math.min(KEEP_VISIBLE, contentSpan / 2, viewportSpan / 2);
}

/**
 * 全屏预览旧平移上限：至少保留 KEEP_VISIBLE 像素；未测量时不设限。
 * @param view 当前视图
 * @param viewport 视口尺寸
 * @param content 内容未变换时的布局尺寸
 * @returns 两轴平移量的绝对值上限
 */
export function viewBounds(view: ImageZoomView, viewport: Size, content: Size): Point {
  if (!viewport.width || !content.width) return { x: Infinity, y: Infinity };
  const box = contentBox(view, viewport, content);
  return {
    x: Math.max(0, (viewport.width + box.width) / 2 - keepVisible(box.width, viewport.width)),
    y: Math.max(0, (viewport.height + box.height) / 2 - keepVisible(box.height, viewport.height)),
  };
}

/** 把平移量夹回上限内，图就不会被拖出视口再也找不回来。 */
export function clampView(view: ImageZoomView, viewport: Size, content: Size): ImageZoomView {
  const bounds = viewBounds(view, viewport, content);
  const x = clampAbs(view.offset.x, bounds.x);
  const y = clampAbs(view.offset.y, bounds.y);
  if (x === view.offset.x && y === view.offset.y) return view;
  return { ...view, offset: { x, y } };
}

/**
 * 换算缩放后的视图。
 * anchor 给定时保持该点在屏幕上不动——滚轮锚在光标上，放大后要看的字不会被挤出视口；
 * 按钮缩放传 null，锚在视口中心。
 * @param view 当前视图
 * @param next 目标倍数，会夹进 [MIN_SCALE, MAX_SCALE]
 * @param anchor 锚点相对视口中心的偏移，null 表示锚在中心
 */
export function scaleTo(view: ImageZoomView, next: number, anchor: Point | null): ImageZoomView {
  const scale = clampScale(next);
  if (scale === view.scale) return view;
  // 锚在中心时平移量不用动：中心点本来就不随缩放移动。
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
 * 锚点换算：把屏幕坐标换成「相对视口中心的偏移」，即 scaleTo 要的 anchor。
 * @param point 屏幕坐标（WheelEvent / MouseEvent 都满足）
 * @param rect 视口矩形，拿不到时返回 null 表示锚在中心
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

/** 平移。dx/dy 是屏幕位移，直接相加即 1:1 跟手。 */
export function panBy(view: ImageZoomView, dx: number, dy: number): ImageZoomView {
  return { ...view, offset: { x: view.offset.x + dx, y: view.offset.y + dy } };
}

/**
 * 将原图归一化坐标中的识别块居中；旋转后按屏幕坐标换算平移量。
 * @param block 识别块坐标
 * @param view 当前缩放与旋转
 * @param viewport 视口尺寸
 * @param content 图片的布局尺寸
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
 * 按最终布局尺寸绘制原图；变换只处理平移和旋转，框线与编号保持固定尺寸。
 * @param view 当前视图
 * @param viewport 视口尺寸
 * @param content 图片未缩放的布局尺寸
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
 * 将图片旋转后的宽度贴合视口；长图从顶部开始，后续可拖动核对。
 * @param view 当前视图
 * @param viewport 视口尺寸
 * @param content 图片未缩放的布局尺寸
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
 * @param view 当前视图
 * @param direction 1 顺时针，-1 逆时针
 */
export function rotateView(view: ImageZoomView, direction: 1 | -1 = 1): ImageZoomView {
  // 先加 360 再取模，避免逆时针在 0° 时算出 -90。
  return { ...view, rotation: (view.rotation + 360 + 90 * direction) % 360 };
}

/** 只还原缩放与平移，保留角度——双击用，纠正过方向的图不该被一并转回去。 */
export function resetZoom(view: ImageZoomView): ImageZoomView {
  return { ...view, scale: FIT_SCALE, offset: { x: 0, y: 0 } };
}

/** 是否偏离初始视图，用于决定是否显示「还原」。 */
export function isTransformed(view: ImageZoomView): boolean {
  return (
    view.scale !== FIT_SCALE || view.rotation !== 0 || view.offset.x !== 0 || view.offset.y !== 0
  );
}

/**
 * 生成 CSS transform。顺序见文件头说明，改动顺序会同时破坏平移方向与锚点换算。
 * @param view 当前视图
 * @param viewport 视口尺寸
 * @param content 内容未变换时的布局尺寸
 */
export function viewTransform(view: ImageZoomView, viewport: Size, content: Size): string {
  const scale = view.scale * fitFactor(view.rotation, viewport, content);
  return `translate(${round(view.offset.x)}px, ${round(view.offset.y)}px) scale(${round(scale, 4)}) rotate(${view.rotation}deg)`;
}

/** 收掉浮点噪声，避免 style 字符串每帧都长得不一样。 */
function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
