import type { AppRoute } from '@map/types';
import i18n from '@/i18n';

export const routePrefetchers: Record<string, () => Promise<unknown>> = {};

export const staticRoutes: AppRoute[] = [
  {
    path: '/playground',
    meta: {
      title: i18n.t('shell:navigation.playground'),
      icon: 'MessageSquare',
      sort: 10,
      external: `${import.meta.env.BASE_URL}playground`,
    },
  },
];

i18n.on('languageChanged', () => {
  const route = staticRoutes.find((item) => item.path === '/playground');
  if (route) route.meta.title = i18n.t('shell:navigation.playground');
});
