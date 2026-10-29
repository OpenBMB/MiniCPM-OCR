import { describe, expect, it } from 'vitest';
import { getPortalRouteTitle } from './routeCopy';

describe('门户路由文案', () => {
  it('中文保留首页及现有菜单名称', () => {
    expect(getPortalRouteTitle('/', 'zh-CN', '首页')).toBe('首页');
    expect(getPortalRouteTitle('/models', 'zh-CN', '模型列表')).toBe('模型列表');
    expect(getPortalRouteTitle('/recharges', 'zh-CN', '充值记录')).toBe('额度中心');
    expect(getPortalRouteTitle('/docs', 'zh-CN', '文档')).toBe('API 文档');
    expect(getPortalRouteTitle('/profile', 'zh-CN', '账号安全')).toBe('个人设置');
  });

  it('英文为核心导航提供稳定译名', () => {
    expect(getPortalRouteTitle('/', 'en-US', '首页')).toBe('Home');
    expect(getPortalRouteTitle('/playground', 'en-US', '体验中心')).toBe('Playground');
    expect(getPortalRouteTitle('/profile', 'en-US', '个人设置')).toBe('Personal settings');
  });

  it('未收录的路由回退到原始标题', () => {
    expect(getPortalRouteTitle('/custom', 'en-US', 'Custom Page')).toBe('Custom Page');
  });
});
