import type { ImageParseMode } from '@/api/map/imageParseSdk';
import { isImageParseSharedExample } from './imageParseExamples';

/** File and execution parameters a PDF recognition result belongs to. */
export interface PdfParseScope {
  id?: string;
  source: string;
  mode: ImageParseMode;
  model: string;
  projectId: string;
  upright: boolean;
}

/**
 * Whether a PDF result can be used in the current context; a shared example is not bound to the user's execution parameters.
 * @param previous result scope
 * @param next current scope
 * @returns whether the result is still valid
 */
export function samePdfScope(previous: PdfParseScope | undefined, next: PdfParseScope): boolean {
  return (
    previous?.id === next.id &&
    previous?.source === next.source &&
    previous?.mode === next.mode &&
    (isImageParseSharedExample(next.id ?? '') ||
      (previous?.model === next.model &&
        previous?.projectId === next.projectId &&
        previous?.upright === next.upright))
  );
}
