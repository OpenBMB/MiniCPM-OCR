import { describe, expect, it } from 'vitest';
import { staticRoutes } from './routes';

describe('文档解析演示路由', () => {
  it('只保留体验页入口', () => {
    expect(staticRoutes.map((route) => route.path)).toEqual(['/playground']);
  });
});
