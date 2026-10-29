import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { useAppStore, type AppLocale } from '@map/store';
import { i18nResources } from './resources';

const configuredDefaultLocale: AppLocale =
  import.meta.env.VITE_DEFAULT_LOCALE === 'en-US' ? 'en-US' : 'zh-CN';

// 仅在当前站点没有持久化偏好时应用部署默认语言；已有用户选择不被环境切换覆盖。
if (typeof window !== 'undefined' && !window.localStorage.getItem('map-app')) {
  useAppStore.getState().setLocale(configuredDefaultLocale);
}

i18n.use(initReactI18next).init({
  resources: i18nResources,
  lng: useAppStore.getState().locale,
  fallbackLng: 'zh-CN',
  defaultNS: 'shell',
  interpolation: { escapeValue: false },
  // 资源随前端 bundle 一同加载，可同步初始化以避免首帧出现翻译键。
  initAsync: false,
});

i18n.on('languageChanged', (language) => {
  syncDocumentLanguage(language);
});

syncDocumentLanguage(i18n.language);

/**
 * 切换门户界面语言并同步持久化偏好。
 * @param locale 目标界面语言。
 * @returns 语言资源完成切换后的 Promise。
 */
export async function setApplicationLocale(locale: AppLocale): Promise<void> {
  useAppStore.getState().setLocale(locale);
  await i18n.changeLanguage(locale);
}

export default i18n;

/**
 * 将当前语言同步到文档根节点，供浏览器与辅助技术识别内容语言。
 * @param locale i18next 当前语言。
 */
function syncDocumentLanguage(locale: string): void {
  document.documentElement.lang = locale === 'en-US' ? 'en-US' : 'zh-CN';
  document.documentElement.dir = 'ltr';
}
