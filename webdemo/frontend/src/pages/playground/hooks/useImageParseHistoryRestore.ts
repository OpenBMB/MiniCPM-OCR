import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import {
  IMAGE_PARSE_DEFAULT_MODE,
  isImageParsePipelineMode,
  type ImageParseMode,
} from '@/api/map/imageParseSdk';
import type { ImageParseSource } from '@/api/map/imageParseSource';

import type { Attachment } from '../types';
import type { ImageParseLayoutBlock } from '../utils/imageParseSample';
import type { ImageParseRotationInfo } from '../utils/imageParseSample';
import { sanitizeImageParseSnapshot, type ImageParseSnapshot } from '../utils/imageParseHistory';
import { isImageParseSharedExample } from '../utils/imageParseExamples';
import type { useImageParseCrops } from './useImageParseCrops';
import type { usePdfImageParse } from './usePdfImageParse';

interface ImageParseHistoryRestoreContext {
  restoreBoundary: (mode: ImageParseMode) => void;
  generation: MutableRefObject<number>;
  pdf: ReturnType<typeof usePdfImageParse>;
  setImage: (attachment?: Attachment) => void;
  cancel: () => void;
  loadCrops: ReturnType<typeof useImageParseCrops>['loadCrops'];
  /** When the image does not have a recognition result yet, continue automatic recognition after restore. */
  markPending?: () => void;
}

interface ImageParseHistoryRestoreSetters {
  setMode: (mode: ImageParseMode) => void;
  setFields?: Dispatch<SetStateAction<string[]>>;
  setMarkdown: Dispatch<SetStateAction<string>>;
  setLayout: Dispatch<SetStateAction<readonly ImageParseLayoutBlock[]>>;
  setSource?: Dispatch<SetStateAction<ImageParseSource | undefined>>;
  setRotation?: Dispatch<SetStateAction<ImageParseRotationInfo | undefined>>;
  setFinished: Dispatch<SetStateAction<boolean>>;
  setResultRevision: Dispatch<SetStateAction<number>>;
}

/**
 * A cache restore rebuilds only the local result and crops, and synchronously cancels automatic execution and old OCR callbacks.
 * @param context current task scope, cancel boundary, and PDF orchestration
 * @param setters state writers for the raw recognition result
 * @returns a restore function that accepts a snapshot and reports whether it is valid; later recognition uses the workspace default tier
 */
export function useImageParseHistoryRestore(
  {
    restoreBoundary,
    generation,
    pdf,
    setImage,
    cancel,
    loadCrops,
    markPending,
  }: ImageParseHistoryRestoreContext,
  {
    setMode,
    setFields,
    setMarkdown,
    setLayout,
    setSource,
    setRotation,
    setFinished,
    setResultRevision,
  }: ImageParseHistoryRestoreSetters,
) {
  // A fixed shared-example snapshot does not change within the current session; ordinary history is still validated as untrusted input every time.
  const examples = useRef(new WeakMap<ImageParseSnapshot, ImageParseSnapshot>());
  return useCallback(
    (value: ImageParseSnapshot, options?: { previewOnly?: boolean; finished?: boolean }) => {
      const reuse = !options?.previewOnly && isImageParseSharedExample(value.attachment?.id);
      const safe =
        (reuse && examples.current.get(value)) ||
        sanitizeImageParseSnapshot(value, {
          allowHydratedFileURL: true,
          allowSharedImagePreview: options?.previewOnly === true,
        });
      if (!safe) return false;
      if (reuse) examples.current.set(value, safe);
      // An existing LIS tier returns to the default tier after restore; a pipeline tier must be kept, or KIE fields and
      // seal results would be treated as document parsing by the next recognition.
      const cached = {
        ...safe,
        mode: isImageParsePipelineMode(safe.mode) ? safe.mode : IMAGE_PARSE_DEFAULT_MODE,
      };
      setImage(cached.attachment);
      cancel();
      pdf.stop();
      restoreBoundary(cached.mode);
      if (cached.pdf) pdf.restore(cached.attachment, cached.mode, cached.pdf);
      setMode(cached.mode);
      setFields?.(cached.mode === 'kie' ? [...(cached.fields ?? [])] : []);
      setMarkdown(cached.markdown);
      setLayout(cached.layout);
      // The default tier affects only later parsing, and must not rewrite the real model and server time in the history source.
      setSource?.(cached.source);
      setRotation?.(cached.rotation);
      const imagePending =
        !cached.pdf &&
        !options?.previewOnly &&
        !options?.finished &&
        cached.markdown === '' &&
        cached.layout.length === 0;
      setFinished(!options?.previewOnly && !imagePending);
      if (imagePending) markPending?.();
      if (!cached.pdf && !options?.previewOnly && !imagePending) {
        const run = generation.current;
        void loadCrops(
          {
            markdown: cached.markdown,
            blocks: cached.layout,
            rotation: cached.rotation,
          },
          cached.attachment.dataUrl,
          new AbortController().signal,
          () => generation.current === run,
        );
      }
      setResultRevision((value) => value + 1);
      return true;
    },
    [
      cancel,
      generation,
      loadCrops,
      markPending,
      pdf,
      restoreBoundary,
      setFinished,
      setImage,
      setLayout,
      setMarkdown,
      setMode,
      setFields,
      setResultRevision,
      setSource,
      setRotation,
    ],
  );
}
