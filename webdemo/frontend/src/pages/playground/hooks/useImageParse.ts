import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { IMAGE_PARSE_DEFAULT_MODE, type ImageParseMode } from '@/api/map/imageParseSdk';
import type { Attachment } from '../types';
import { imageParseBlockedReason } from '../utils/imageParseEligibility';
import { usePdfImageParse } from './usePdfImageParse';
import { isPdfAttachment } from '../utils/documentUpload';
import type { ImageParseProgressSnapshot } from '../utils/imageParseSimulation';
import type { usePlaygroundModel } from './usePlaygroundModel';
import { useAppStore } from '@map/store';
import { useImageParseExecution } from './useImageParseExecution';
import { useImageParseHistoryState } from './useImageParseHistoryState';
import type { PdfImageParseSnapshot } from '../utils/imageParseHistoryTypes';
import { useImageParseImageState } from './useImageParseImageState';
import { useImageParseTableMerge } from './useImageParseTableMerge';
import { useImageParseTaskNavigation } from './useImageParseTaskNavigation';
import { useImageParseRecognitionAutoRun } from './useImageParseRecognitionAutoRun';
import type { PdfImageParseRestoreOptions } from './usePdfImageParseHistory';

/** 编排图片/PDF 识别与历史恢复。
 * @param model 当前账号、项目与模型上下文
 * @returns 识别状态、服务端来源及历史恢复入口 */
export function useImageParse(
  model: ReturnType<typeof usePlaygroundModel>,
  {
    autoParse = true,
    autoParseOnUpload = false,
    initialMode = IMAGE_PARSE_DEFAULT_MODE,
  }: {
    autoParse?: boolean;
    autoParseOnUpload?: boolean;
    initialMode?: ImageParseMode;
  } = {},
) {
  const { t } = useTranslation('playground');
  const scope = JSON.stringify([model.userId, model.defaultProjectId]);
  const image = useImageParseImageState(autoParse, autoParseOnUpload, initialMode);
  const {
    attachment,
    markdown,
    source,
    rotation,
    error,
    loading,
    finished,
    layout,
    resultRevision,
    setResultRevision,
    setMarkdown,
    setSource,
    setRotation,
    setFinished,
    setLayout,
    crops,
    clearCrops,
    loadCrops,
    sharedExample,
    active,
    generation,
    pendingAuto,
    cancel,
    setImage,
    setDocument,
    setAttachmentReference,
    mode,
    fields,
    setFields,
    upright,
    setUpright,
    recognizeSeal,
    setRecognizeSeal,
    recognizeChart,
    setRecognizeChart,
    setMode,
  } = image;
  const modelId = model.imageParseModel?.id;
  const pdfActive = Boolean(attachment && isPdfAttachment(attachment));
  const hideHeaderFooter = useAppStore((s) => s.playground.imageParseHideHeaderFooter);
  const pdf = usePdfImageParse(
    attachment,
    mode,
    modelId ?? '',
    model.defaultProjectId ?? '',
    !!modelId && !sharedExample && mode !== 'seal',
    undefined,
    hideHeaderFooter,
    upright,
    autoParse && mode !== 'kie',
    recognizeSeal,
    fields,
  );
  const blocked = imageParseBlockedReason(attachment, model, mode);
  const { parse, stop } = useImageParseExecution({
    context: {
      activeRef: active,
      generationRef: generation,
      pendingAutoRef: pendingAuto,
      setImage,
      setAttachmentReference,
      cancel,
    },
    setters: image,
    attachment,
    mode,
    fields,
    upright,
    recognizeSeal,
    recognizeChart,
    modelId,
    projectId: model.defaultProjectId ?? '',
    sharedExample,
    pdfActive,
    blocked,
    pdf,
    clearCrops,
    loadCrops,
  });
  const hasStableResult =
    !(pdfActive ? pdf.loading : loading) && (finished || Boolean(pdf.completed));
  useImageParseRecognitionAutoRun({
    upright,
    recognizeSeal,
    hasResult: hasStableResult,
    identity: attachment?.id,
    onReRun: parse,
  });
  const { snapshot, restore, valid, pdfError, currentSource, currentRotation, visible } =
    useImageParseHistoryState({
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
      pendingAutoRef: pendingAuto,
      generationRef: generation,
      loadCrops,
      setMode,
      setFields,
      setMarkdown,
      setLayout,
      setSource,
      setRotation,
      setFinished,
      setResultRevision,
      autoParse,
    });
  const imageTableMergeEnabled =
    !pdfActive && !sharedExample && valid && mode !== 'seal' && mode !== 'kie';
  const imageTableMerge = useImageParseTableMerge({
    enabled: imageTableMergeEnabled,
    markdown,
    layout,
    setMarkdown,
    setLayout,
    finished,
    loading,
    resultRevision,
    attachmentId: attachment?.id,
  });
  const selectTask = useImageParseTaskNavigation({
    scope,
    attachment,
    mode,
    snapshot,
    restore,
    selectMode: setMode,
    resultRevision,
    setResultRevision,
    finished,
  });
  const restorePdf = pdf.restore;
  const appendDocument = useCallback(
    (
      next: Attachment,
      pdfSnapshot: PdfImageParseSnapshot,
      options?: PdfImageParseRestoreOptions,
    ) => {
      restorePdf(next, mode, pdfSnapshot, options);
      setImage(next);
    },
    [mode, restorePdf, setImage],
  );
  const resultKeyForPage = (page = pdf.page) =>
    `${attachment?.id ?? ''}:${mode}:${resultRevision}${pdfActive ? `:${pdf.resultIdentityForPage(page)}:${page}` : ''}`;
  return {
    snapshot,
    restore,
    resultKey: resultKeyForPage(),
    documentKey: `${attachment?.id ?? ''}:${resultRevision}:${mode}`,
    resultKeyForPage,
    attachment,
    setAttachment: setDocument,
    markdown: pdfActive ? (pdf.current?.result?.markdown ?? '') : visible.markdown,
    ...(valid && currentSource ? { source: currentSource } : {}),
    ...(valid && currentRotation ? { rotation: currentRotation } : {}),
    mode,
    fields,
    upright,
    recognizeSeal,
    recognizeChart,
    setFields,
    setUpright,
    setRecognizeSeal,
    setRecognizeChart,
    setMode: selectTask,
    loading: pdfActive ? pdf.loading : loading,
    finished: !pdfActive && valid && finished,
    error: pdfActive && pdfError ? t(pdfError) : error,
    progress: null as ImageParseProgressSnapshot | null,
    layout: pdfActive ? (pdf.current?.result?.blocks ?? []) : visible.blocks,
    crops: pdfActive ? (pdf.current?.crops ?? []) : crops,
    pdf: pdfActive ? pdf : undefined,
    ...(imageTableMergeEnabled ? { imageTableMerge } : {}),
    blockedReason: blocked,
    parse,
    stop,
    appendDocument,
    clear: () => setImage(undefined),
    canParse: !sharedExample && !blocked && !(pdfActive ? pdf.loading : loading),
  };
}
