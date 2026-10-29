/** Image-parsing layout block types and old sample IDs; runtime recognition results can come only from the server. */

/**
 * Attachment IDs of old built-in samples. Used only to refuse history cache that would save a local demo result as a personal record,
 * and no longer provides any local demo attachment or recognition result.
 */
export const IMAGE_PARSE_SAMPLE_ATTACHMENT_ID = 'image-parse-sample';

/** Semantic type of a layout block; it decides box color and the type badge. */
export type ImageParseBlockKind =
  | 'header'
  | 'footer'
  | 'heading'
  | 'text'
  | 'table'
  | 'formula'
  | 'list'
  | 'note'
  | 'image'
  | 'chart'
  | 'seal';

/** Server rotation-adaptation info; coordinates are always based on the image after rotation adaptation. */
export interface ImageParseRotationInfo {
  enabled: boolean;
  applied: boolean;
  /** Actual counterclockwise rotation angle from the server; the browser displays the opposite angle. */
  totalAngle: number;
  /** null when rotation adaptation produced no prediction (disabled / gated). */
  predictedAngle: number | null;
  predictedScore: number | null;
  confirmed: boolean | null;
  orientationAngle: number;
  deskewAngle: number;
  skippedReason: string | null;
}

/** One normalized region inside a layout block; a merged block can contain several regions. */
export interface ImageParseLayoutRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One layout block: normalized coordinates (0–1) + semantic type + recognition content. */
export interface ImageParseLayoutBlock {
  /** Stable id returned by the service, optional; when there is no id, combine coordinates and reading order. */
  id?: string;
  /** The service reading index starts at 0; an old result with none uses the array position. */
  order?: number;
  label?: string;
  status?: string;
  /** UTF-16 start and end offsets in the whole Markdown, used to remove ambiguity from repeated text. */
  markdownStart?: number;
  markdownEnd?: number;
  kind: ImageParseBlockKind;
  /** Top-left x, as a fraction of image width */
  x: number;
  /** Top-left y, as a fraction of image height */
  y: number;
  /** Width fraction */
  w: number;
  /** Height fraction */
  h: number;
  /** Every region returned by the server; when absent, render the primary bbox. */
  regions?: readonly ImageParseLayoutRegion[];
  /**
   * Original text recognized on the image for this block: keep the line breaks on the image; a table breaks rows into lines and separates columns with tabs.
   * The difference from markdown is that there is no structure here — headings have no `#`, lists have no `-`, and a checkbox is the character itself.
   */
  text: string;
  /** Structured Markdown fragment for this block; joined in reading order it is the content of the "original text" page. */
  markdown: string;
  /** 0–1 confidence returned by the service, or null when missing; the frontend does not estimate. */
  confidence: number | null;
  /** Cross-page table-merge flag; when true, score represents only the first half of the table before the merge. */
  ttsInvalid?: boolean;
  /** Cross-page table merge: this block continues the previous page's table, its content was merged into the previous page, and this page is cleared. */
  mergedIntoPreviousPage?: boolean;
}
