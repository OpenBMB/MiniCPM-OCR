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
 * 连接识别状态与历史恢复：范围/档位变化时失效旧快照，并派生页眉页脚过滤后的可见结果。
 * @param options 当前识别状态、历史恢复上下文与全部状态写入器
 * @returns 可保存快照、恢复入口、PDF 错误与当前可见结果
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
  // 单图结果的页眉页脚过滤；PDF 在 usePdfImageParse 里过滤。历史快照仍存原始结果。
  const visible = useMemo(() => {
    const stable = stabilizeImageParseResult({ markdown, blocks: layout });
    return hideHeaderFooter ? hideImageParseHeaderFooter(stable) : stable;
  }, [hideHeaderFooter, markdown, layout]);
  return { snapshot, restore, valid, pdfError, currentSource, currentRotation, visible };
}
