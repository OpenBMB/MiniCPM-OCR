import type { PortalLocale } from '@/utils/locale';

const ROUTE_COPY: Record<PortalLocale, Record<string, string>> = {
  'zh-CN': {
    '/': '首页',
    '/playground': '体验中心',
    '/models': '模型列表',
    '/voices': '我的音色',
    '/usage': '用量',
    '/recharges': '额度中心',
    '/contact': '联系我们',
    '/profile': '个人设置',
    '/docs': 'API 文档',
  },
  'en-US': {
    '/': 'Home',
    '/playground': 'Playground',
    '/keys': 'API Keys',
    '/models': 'Models',
    '/voices': 'My Voices',
    '/usage': 'Usage',
    '/recharges': 'Credit Center',
    '/contact': 'Contact Us',
    '/profile': 'Personal settings',
    '/docs': 'API Docs',
  },
};

/**
 * 根据当前语言返回门户路由显示名称。
 * @param path 路由路径。
 * @param locale 当前界面语言。
 * @param fallback 路由元数据中的默认名称。
 */
export function getPortalRouteTitle(path: string, locale: PortalLocale, fallback: string): string {
  return ROUTE_COPY[locale][path] ?? fallback;
}
