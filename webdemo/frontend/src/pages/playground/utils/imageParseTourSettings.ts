import type { Driver } from 'driver.js';

/** The two triggers whose settings menu must be expanded during the tour. */
export const IMAGE_PARSE_TOUR_SETTINGS_TRIGGER_SELECTOR =
  '[data-tour="image-parse-recognition-settings"], [data-tour="image-parse-confidence-toggle"]';

/** The settings step temporarily hides the mask, so the menu is not dimmed by the tour layer. */
export const IMAGE_PARSE_TOUR_SETTINGS_CLASS = 'map-tour-settings-showcase';

/** While the settings menu is open, keep a safe distance between the tour copy and the menu. */
const SETTINGS_POPOVER_OFFSET = 200;
/** Ordinary steps keep driver.js default spacing. */
const DEFAULT_POPOVER_OFFSET = 10;

/**
 * Whether the current tour target is a settings entry that needs its menu expanded.
 * @param element element currently highlighted by driver.js
 * @returns whether it is the recognition-settings or display-settings trigger
 */
export function isImageParseTourSettingsTrigger(element: Element | undefined): boolean {
  return Boolean(element?.matches(IMAGE_PARSE_TOUR_SETTINGS_TRIGGER_SELECTOR));
}

/**
 * The settings step switches tour copy and highlight range; other steps restore the default mask and spacing.
 * @param element element currently highlighted by driver.js
 * @param instance current tour instance
 */
export function syncTourStepHighlight(
  element: Element | undefined,
  instance: Pick<Driver, 'getConfig' | 'setConfig'>,
): void {
  const settingsStep = isImageParseTourSettingsTrigger(element);
  document.body.classList.toggle(IMAGE_PARSE_TOUR_SETTINGS_CLASS, settingsStep);
  instance.setConfig({
    ...instance.getConfig(),
    popoverOffset: settingsStep ? SETTINGS_POPOVER_OFFSET : DEFAULT_POPOVER_OFFSET,
  });
}

/** Clear styles that belong only to the settings step when the tour closes or is left. */
export function clearTourStepHighlight(): void {
  document.body.classList.remove(IMAGE_PARSE_TOUR_SETTINGS_CLASS);
}
