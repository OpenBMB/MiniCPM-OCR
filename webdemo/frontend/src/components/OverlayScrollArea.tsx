import { type ComponentProps, type ComponentType, type ReactNode } from 'react';
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react';
import type { PartialOptions } from 'overlayscrollbars';

type OverlayScrollElement = 'div' | 'main' | 'nav';

interface OverlayScrollAreaProps extends Omit<ComponentProps<'div'>, 'children'> {
  element?: OverlayScrollElement;
  children: ReactNode;
  options?: PartialOptions;
}

const overlayScrollOptions: PartialOptions = {
  overflow: {
    x: 'hidden',
    y: 'scroll',
  },
  scrollbars: {
    theme: 'os-theme-map-overlay',
    visibility: 'auto',
    autoHide: 'scroll',
    autoHideDelay: 650,
    autoHideSuspend: false,
  },
};

const OverlayScrollbars = OverlayScrollbarsComponent as unknown as ComponentType<
  ComponentProps<'div'> & {
    element?: OverlayScrollElement;
    options?: PartialOptions;
    defer?: boolean;
  }
>;

export function OverlayScrollArea({
  element = 'div',
  children,
  options = overlayScrollOptions,
  ...props
}: OverlayScrollAreaProps) {
  return (
    <OverlayScrollbars element={element} options={options} defer {...props}>
      {children}
    </OverlayScrollbars>
  );
}
