/**
 * KaTeX 统一安全与资源限制。
 *
 * 用途：裸公式校验和最终 DOM 渲染共用同一套限制，避免模型内容触发外部资源或异常尺寸。
 */

import type { KatexOptions } from 'katex';

/** 不信任模型输入，并限制宏展开次数与可生成的最大尺寸。 */
export const SAFE_KATEX_OPTIONS = {
  maxExpand: 1_000,
  maxSize: 50,
  strict: 'ignore',
  trust: false,
} satisfies KatexOptions;
