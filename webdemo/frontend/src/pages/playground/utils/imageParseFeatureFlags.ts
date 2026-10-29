/**
 * Document-parsing feature flags. The review entry is currently hidden, and historical-result compatibility is kept.
 */
export const IMAGE_PARSE_REVIEW_ENABLED = false;

/** Playground table merge is on by default; cross-page tables and adjacent tables in a single image share the build flag. */
export const IMAGE_PARSE_CROSS_PAGE_MERGE_ENABLED =
  import.meta.env.VITE_IMAGE_PARSE_CROSS_PAGE_MERGE !== 'false';
