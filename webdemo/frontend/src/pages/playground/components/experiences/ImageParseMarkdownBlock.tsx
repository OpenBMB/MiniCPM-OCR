import { useContext, type ComponentPropsWithoutRef } from 'react';
import type { ExtraProps } from 'react-markdown';

import { ImageParseBlockEditContext } from '../../utils/imageParseBlockEditContext';

/** 可信块标记转为可编辑预览；普通 HTML div 继续沿用原有属性和内容。 */
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
