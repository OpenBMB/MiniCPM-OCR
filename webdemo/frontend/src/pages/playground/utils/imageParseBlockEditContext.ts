import { createContext, type ReactNode } from 'react';

import type { ImageParseTextRange } from './imageParseBlocks';

/** 预览块的编辑入口；组件类型保持稳定，切块时不重建其它预览 DOM。 */
export const ImageParseBlockEditContext = createContext<{
  renderBlock: (range: ImageParseTextRange, children: ReactNode) => ReactNode;
} | null>(null);
