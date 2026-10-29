/**
 * 文档解析功能开关。当前隐藏待复核入口，保留历史结果兼容。
 */
export const IMAGE_PARSE_REVIEW_ENABLED = false;

/** Playground 表格合并默认开启；跨页与单图相邻表格共用构建开关。 */
export const IMAGE_PARSE_CROSS_PAGE_MERGE_ENABLED =
  import.meta.env.VITE_IMAGE_PARSE_CROSS_PAGE_MERGE !== 'false';
