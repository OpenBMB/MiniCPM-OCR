/** 门户支持的界面语言。 */
export type PortalLocale = 'zh-CN' | 'en-US';

/** 全局语言状态写入函数。 */
export type LocaleSetter = (locale: PortalLocale) => void;

/**
 * 保存新语言并主动刷新当前页面。
 *
 * 用途：让依赖初始化文案、图表和第三方组件的页面在同一语言下重新挂载，避免局部中英混排。
 * @param locale 目标语言。
 * @param setLocale 全局语言状态写入函数。
 * @param reload 页面刷新函数，便于单元测试替换。
 */
export function switchLocaleAndReload(
  locale: PortalLocale,
  setLocale: LocaleSetter,
  reload: () => void = () => window.location.reload(),
): void {
  setLocale(locale);
  reload();
}
