/** UI languages the portal supports. */
export type PortalLocale = 'zh-CN' | 'en-US';

/** Writer for the global language state. */
export type LocaleSetter = (locale: PortalLocale) => void;

/**
 * Save the new language and reload the current page.
 *
 * Purpose: remount pages that depend on copy, charts, and third-party components initialized for one language, so Chinese and English are not mixed in one view.
 * @param locale Target language.
 * @param setLocale Writer for the global language state.
 * @param reload Page reload function, replaceable in unit tests.
 */
export function switchLocaleAndReload(
  locale: PortalLocale,
  setLocale: LocaleSetter,
  reload: () => void = () => window.location.reload(),
): void {
  setLocale(locale);
  reload();
}
