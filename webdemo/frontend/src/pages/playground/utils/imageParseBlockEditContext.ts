import { createContext, type ReactNode } from 'react';

import type { ImageParseTextRange } from './imageParseBlocks';

/** Edit entry for a preview block; the component type stays stable so switching blocks does not rebuild the other preview DOM. */
export const ImageParseBlockEditContext = createContext<{
  renderBlock: (range: ImageParseTextRange, children: ReactNode) => ReactNode;
} | null>(null);
