import {
  useCallback,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

import type { ImageParseMode } from '@/api/map/imageParseSdk';
import type { ImageParseSource } from '@/api/map/imageParseSource';

import type { Attachment } from '../types';
import {
  hideImageParseHeaderFooter,
  stabilizeImageParseResult,
} from '../utils/imageParseHeaderFooter';
import type { ImageParseLayoutBlock, ImageParseRotationInfo } from '../utils/imageParseSample';
import type { useImageParseCrops } from './useImageParseCrops';
import type { usePdfImageParse } from './usePdfImageParse';
import {
  useImageParseHistoryLifecycle,
  useImageParseHistorySnapshot,
} from './useImageParseHistoryLifecycle';
import { useImageParseHistoryRestore } from './useImageParseHistoryRestore';

interface ImageParseHistoryStateOptions {
  scope: string;
  mode: ImageParseMode;
  attachment?: Attachment;
  fields: readonly string[];
  markdown: string;
  layout: readonly ImageParseLayoutBlock[];
  source?: ImageParseSource;
  rotation?: ImageParseRotationInfo;
  finished: boolean;
  loading: boolean;
  error?: string;
  pdfActive: boolean;
  pdf: ReturnType<typeof usePdfImageParse>;
  hideHeaderFooter: boolean;
  cancel: () => void;
  setImage: (attachment?: Attachment) => void;
  parse: () => Promise<void>;
  pendingAutoRef: MutableRefObject<boolean>;
  generationRef: MutableRefObject<number>;
  loadCrops: ReturnType<typeof useImageParseCrops>['loadCrops'];
  setMode: (mode: ImageParseMode) => void;
  setFields: Dispatch<SetStateAction<string[]>>;
  setMarkdown: Dispatch<SetStateAction<string>>;
  setLayout: Dispatch<SetStateAction<readonly ImageParseLayoutBlock[]>>;
  setSource: Dispatch<SetStateAction<ImageParseSource | undefined>>;
  setRotation: Dispatch<SetStateAction<ImageParseRotationInfo | undefined>>;
  setFinished: Dispatch<SetStateAction<boolean>>;
  setResultRevision: Dispatch<SetStateAction<number>>;
  autoParse?: boolean;
}

/**
 * Connect recognition state and history restore: invalidate the old snapshot when the scope or tier changes, and derive the visible result after header and footer filtering.
 * @param options current recognition state, history-restore context, and every state writer
 * @returns the snapshot that can be saved, the restore entry, the PDF error, and the currently visible result
 */
export function useImageParseHistoryState(options: ImageParseHistoryStateOptions) {
  const {
    scope,
    mode,
    attachment,
    fields,
    markdown,
    layout,
    source,
    rotation,
    finished,
    loading,
    error,
    pdfActive,
    pdf,
    hideHeaderFooter,
    cancel,
    setImage,
    parse,
    pendingAutoRef,
    generationRef,
    loadCrops,
    setMode,
    setFields,
    setMarkdown,
    setLayout,
    setSource,
    setRotation,
    setFinished,
    setResultRevision,
    autoParse = true,
  } = options;
  const { valid, restoreBoundary } = useImageParseHistoryLifecycle({
    scope,
    mode,
    attachment,
    loading,
    cancel,
    setImage,
    parse,
    pendingAuto: pendingAutoRef,
  });
  const markPending = useCallback(() => {
    pendingAutoRef.current = autoParse;
  }, [autoParse, pendingAutoRef]);
  const restore = useImageParseHistoryRestore(
    {
      restoreBoundary,
      generation: generationRef,
      pdf,
      setImage,
      cancel,
      loadCrops,
      markPending,
    },
    {
      setMode,
      setFields,
      setMarkdown,
      setLayout,
      setSource,
      setRotation,
      setFinished,
      setResultRevision,
    },
  );
  const snapshot = useImageParseHistorySnapshot({
    attachment,
    mode,
    fields,
    markdown,
    layout,
    source,
    rotation,
    finished,
    loading,
    error,
    pdfActive,
    valid,
    pdf: pdf.snapshot,
  });
  const pdfError = pdf.current?.error ?? pdf.error;
  let currentSource: ImageParseSource | undefined;
  let currentRotation: ImageParseRotationInfo | undefined;
  if (valid) {
    currentSource = pdfActive ? pdf.current?.result?.source : source;
    currentRotation = pdfActive ? pdf.current?.result?.rotation : rotation;
  }
  // Header and footer filtering for a single-image result; a PDF is filtered in usePdfImageParse. The history snapshot still stores the raw result.
  const visible = useMemo(() => {
    const stable = stabilizeImageParseResult({ markdown, blocks: layout });
    return hideHeaderFooter ? hideImageParseHeaderFooter(stable) : stable;
  }, [hideHeaderFooter, markdown, layout]);
  return { snapshot, restore, valid, pdfError, currentSource, currentRotation, visible };
}
