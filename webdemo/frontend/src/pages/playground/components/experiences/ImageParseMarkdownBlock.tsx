import { useContext, type ComponentPropsWithoutRef } from 'react';
import type { ExtraProps } from 'react-markdown';

import { ImageParseBlockEditContext } from '../../utils/imageParseBlockEditContext';

/** A trusted block marker becomes an editable preview; an ordinary HTML div keeps its original attributes and content. */
export function ImageParseMarkdownBlock({
  node,
  children,
  ...props
}: ComponentPropsWithoutRef<'div'> & ExtraProps) {
  const context = useContext(ImageParseBlockEditContext);
  const start = node?.properties.dataEditStart;
  const end = node?.properties.dataEditEnd;
  if (!context || typeof start !== 'number' || typeof end !== 'number') {
    return <div {...props}>{children}</div>;
  }
  return context.renderBlock({ start, end }, children);
}
