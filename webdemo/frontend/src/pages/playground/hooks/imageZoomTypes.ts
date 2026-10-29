import type * as React from 'react';

import type { imageRasterView } from '../utils/imageZoom';

/** 视图状态与交互接线。 */
export interface ImageZoom {
  scale: number;
  rotation: number;
  transform: string;
  raster: ReturnType<typeof imageRasterView>;
  animated: boolean;
  transformed: boolean;
  dragging: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  fitWidth: () => void;
  focusBlock: (
    block: { x: number; y: number; w: number; h: number },
    onPosition?: (progress: number) => void,
  ) => boolean;
  scrollProgress: number;
  scrollToProgress: (progress: number) => void;
  rotate: (direction?: 1 | -1) => void;
  reset: () => void;
  setViewport: (node: HTMLElement | null) => void;
  setContent: (node: HTMLElement | null) => void;
  onDoubleClick: (event: React.MouseEvent<HTMLElement>) => void;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
}
