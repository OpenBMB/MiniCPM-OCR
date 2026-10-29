/** 屏幕坐标系中的点或平移量，单位为 CSS 像素。 */
export interface Point {
  x: number;
  y: number;
}

/** 元素的布局尺寸；宽为 0 表示还没测量到。 */
export interface Size {
  width: number;
  height: number;
}

/** 视图状态。scale=FIT_SCALE 恒定表示「整图贴合视口」，与角度无关。 */
export interface ImageZoomView {
  scale: number;
  /** 屏幕坐标系下的平移量（CSS 像素） */
  offset: Point;
  /** 旋转角度，90° 步进，取值 0/90/180/270 */
  rotation: number;
}
