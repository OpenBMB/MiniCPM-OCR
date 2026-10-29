import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { useAppStore, type AppLocale } from '@map/store';
import { i18nResources } from './resources';

const configuredDefaultLocale: AppLocale =
  import.meta.env.VITE_DEFAULT_LOCALE === 'en-US' ? 'en-US' : 'zh-CN';

// Apply the deploy default language only when this site has no persisted preference; an existing user choice is not overwritten by an environment switch.
if (typeof window !== 'undefined' && !window.localStorage.getItem('map-app')) {
  useAppStore.getState().setLocale(configuredDefaultLocale);
}

i18n.use(initReactI18next).init({
  resources: i18nResources,
  lng: useAppStore.getState().locale,
  fallbackLng: 'zh-CN',
  defaultNS: 'shell',
  interpolation: { escapeValue: false },
  // Resources ship in the frontend bundle and can be initialized synchronously so the first frame does not show translation keys.
  initAsync: false,
});

i18n.on('languageChanged', (language) => {
  syncDocumentLanguage(language);
});

syncDocumentLanguage(i18n.language);

/**
 * Switch the portal UI language and persist the preference.
 * @param locale Target UI language.
 * @returns Promise that resolves when the language resources have switched.
 */
export async function setApplicationLocale(locale: AppLocale): Promise<void> {
  useAppStore.getState().setLocale(locale);
  await i18n.changeLanguage(locale);
}

export default i18n;

/**
 * Sync the current language onto the document root so browsers and assistive technologies can recognize the content language.
 * @param locale Current i18next language.
 */
function syncDocumentLanguage(locale: string): void {
  document.documentElement.lang = locale === 'en-US' ? 'en-US' : 'zh-CN';
  document.documentElement.dir = 'ltr';
}
