/**
 * Unified KaTeX safety and resource limits.
 *
 * Purpose: bare-formula checks and the final DOM render share the same limits, so model content cannot trigger external resources or an abnormal size.
 */

import type { KatexOptions } from 'katex';

/** Do not trust model input, and limit macro expansion count and the maximum size that can be generated. */
export const SAFE_KATEX_OPTIONS = {
  maxExpand: 1_000,
  maxSize: 50,
  strict: 'ignore',
  trust: false,
} satisfies KatexOptions;
