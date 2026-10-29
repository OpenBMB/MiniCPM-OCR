import type { Driver } from 'driver.js';

/** 引导中需要展开设置菜单的两个触发器。 */
export const IMAGE_PARSE_TOUR_SETTINGS_TRIGGER_SELECTOR =
  '[data-tour="image-parse-recognition-settings"], [data-tour="image-parse-confidence-toggle"]';

/** 设置步骤临时隐藏遮罩，避免菜单被引导层压暗。 */
export const IMAGE_PARSE_TOUR_SETTINGS_CLASS = 'map-tour-settings-showcase';

/** 设置菜单展开时，让引导说明与菜单保持安全距离。 */
const SETTINGS_POPOVER_OFFSET = 200;
/** 普通步骤沿用 driver.js 默认间距。 */
const DEFAULT_POPOVER_OFFSET = 10;

/**
 * 判断当前引导目标是否是需要展开菜单的设置入口。
 * @param element driver.js 当前高亮元素
 * @returns 是否为识别设置或显示设置触发器
 */
export function isImageParseTourSettingsTrigger(element: Element | undefined): boolean {
  return Boolean(element?.matches(IMAGE_PARSE_TOUR_SETTINGS_TRIGGER_SELECTOR));
}

/**
 * 设置步骤切换引导说明与高亮范围，其余步骤恢复默认遮罩和间距。
 * @param element driver.js 当前高亮元素
 * @param instance 当前引导实例
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

/** 关闭或离开引导时清理设置步骤专用样式。 */
export function clearTourStepHighlight(): void {
  document.body.classList.remove(IMAGE_PARSE_TOUR_SETTINGS_CLASS);
}
