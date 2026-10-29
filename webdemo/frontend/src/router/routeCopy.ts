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
 * Return the portal route display name for the current language.
 * @param path Route path.
 * @param locale Current UI language.
 * @param fallback Default name from route metadata.
 */
export function getPortalRouteTitle(path: string, locale: PortalLocale, fallback: string): string {
  return ROUTE_COPY[locale][path] ?? fallback;
}
