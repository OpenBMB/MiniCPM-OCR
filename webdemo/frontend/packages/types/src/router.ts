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
  /** 外部链接：设置后该导航项不走内部路由，点击在新标签页打开此 URL */
  external?: string;
  hidden?: boolean;
  keepAlive?: boolean;
  permissions?: string[];
  roles?: string[];
  affix?: boolean;
  sort?: number;
}
