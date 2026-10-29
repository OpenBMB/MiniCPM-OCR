import type { ComponentType, LazyExoticComponent } from 'react';

export interface AppRoute {
  path: string;
  element?: LazyExoticComponent<ComponentType>;
  layout?: 'admin' | 'blank';
  meta: RouteMeta;
  children?: AppRoute[];
}

export interface RouteMeta {
  title: string;
  icon?: string;
  /** External link: when set, this nav item skips internal routing and opens this URL in a new tab. */
  external?: string;
  hidden?: boolean;
  keepAlive?: boolean;
  permissions?: string[];
  roles?: string[];
  affix?: boolean;
  sort?: number;
}
