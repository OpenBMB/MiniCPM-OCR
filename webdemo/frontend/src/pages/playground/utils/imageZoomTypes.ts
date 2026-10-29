/** A point or pan amount in screen coordinates, in CSS pixels. */
export interface Point {
  x: number;
  y: number;
}

/** Layout size of an element; width 0 means it has not been measured yet. */
export interface Size {
  width: number;
  height: number;
}

/** View state. scale=FIT_SCALE always means "the whole image fits the viewport", independent of angle. */
export interface ImageZoomView {
  scale: number;
  /** Pan in screen coordinates (CSS pixels) */
  offset: Point;
  /** Rotation angle, in 90° steps, one of 0/90/180/270 */
  rotation: number;
}
