/** State contract for the progress component; current OCR returns only the final result and does not simulate progress on the frontend. */

/** Parse phases. The order is the execution order; the UI advances the scan and layout boxes in this order. */
export type ImageParseStage = 'layout' | 'structure' | 'render';

/** Server progress snapshot; null when there is no progress event yet, and no percentage is synthesized. */
export interface ImageParseProgressSnapshot {
  stage: ImageParseStage;
  /** Overall progress 0–100 */
  percent: number;
  /** Number of layout blocks already detected, which drives boxes appearing one by one on the original image */
  detectedBlocks: number;
  /** Number of layout blocks whose structure has been restored, which drives the highlight moving down the boxes */
  scannedBlocks: number;
  /** Markdown fragment that has streamed out so far */
  markdown: string;
}
