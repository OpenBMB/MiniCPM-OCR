/**
 * Draft state of a recognition result.
 *
 * Purpose: an OCR result is bound to have errors, and if it can only be viewed and not edited it is only a demo. Here the result becomes an editable draft,
 * and both copy and download take the draft rather than the raw output, so the user can take it away as soon as the edit is done.
 *
 * Follow rule: a new parse (including streaming progress) overwrites the draft — that is a new result, not the user's edit;
 * the user's own changes are marked dirty, and a one-click restore is kept.
 *
 * Implementation does not sync state with useEffect: the edit is stored together with "which version of the result it is based on".
 * Once the result changes, the baseline no longer matches, the draft expires on its own, and it falls back to the new result — one less cascading render.
 */

import { useCallback, useState } from 'react';
import type { ImageParseTextRange } from '../utils/imageParseBlocks';
import { imageParseDraftRanges } from '../utils/imageParseDraftRanges';

const EMPTY_RANGES: ReadonlyMap<string, ImageParseTextRange> = new Map();

/** Draft state. */
export interface ImageParseDraft {
  /** Current text; both copy and download use it */
  value: string;
  /** Whether it differs from the base recognition, including an active regeneration, for the restore action. */
  dirty: boolean;
  /** Whether there is a manual edit; when an old caller does not provide it, treat it as compatible with dirty. */
  manuallyEdited?: boolean;
  setValue: (next: string, editedRange?: ImageParseTextRange, source?: 'user' | 'model') => void;
  /** Original-image positioning ranges kept in sync with the current draft. */
  ranges: ReadonlyMap<string, ImageParseTextRange>;
  /** Discard the edit and return to the model's raw output */
  reset: () => void;
  /** A continuous document preview reads the same draft cache and does not build a separate per-page edit state. */
  forResult?: (
    markdown: string,
    resultKey: string,
    ranges: ReadonlyMap<string, ImageParseTextRange>,
  ) => ImageParseDraft;
}

/** One edit: value is the text after the change, and base is the model output it was based on at the time. */
interface DraftEdit {
  resultKey: string;
  base: string;
  value: string;
  ranges: ReadonlyMap<string, ImageParseTextRange>;
  manuallyEdited: boolean;
}

/**
 * Wrap a parse result as an editable draft.
 * @param markdown raw model output (it keeps changing while streaming)
 * @param resultKey document and parse-round id, so the same output does not restore the previous round's edit
 */
export function useImageParseDraft(
  markdown: string,
  resultKey = '',
  baseRanges: ReadonlyMap<string, ImageParseTextRange> = EMPTY_RANGES,
): ImageParseDraft {
  const [edits, setEdits] = useState<Record<string, DraftEdit>>({});
  const forResult = useCallback(
    (
      base: string,
      key: string,
      ranges: ReadonlyMap<string, ImageParseTextRange>,
    ): ImageParseDraft => {
      const live = edits[key]?.base === base ? edits[key] : undefined;
      return {
        value: live?.value ?? base,
        ranges: live && live.value !== base ? live.ranges : ranges,
        dirty: Boolean(live && live.value !== base),
        manuallyEdited: Boolean(live?.manuallyEdited && live.value !== base),
        setValue: (next, editedRange, source = 'user') =>
          setEdits((previous) => {
            const current = previous[key]?.base === base ? previous[key] : undefined;
            return {
              ...previous,
              [key]: {
                base,
                value: next,
                resultKey: key,
                manuallyEdited: source === 'user' || Boolean(current?.manuallyEdited),
                ranges: imageParseDraftRanges(
                  current?.value ?? base,
                  next,
                  current?.ranges ?? ranges,
                  editedRange,
                ),
              },
            };
          }),
        reset: () =>
          setEdits((previous) => {
            const next = { ...previous };
            delete next[key];
            return next;
          }),
      };
    },
    [edits],
  );
  return { ...forResult(markdown, resultKey, baseRanges), forResult };
}
