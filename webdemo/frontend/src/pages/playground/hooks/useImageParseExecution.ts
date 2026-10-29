import {
  useCallback,
  useContext,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { type ImageParseMode, type ImageParseSdkResult } from '@/api/map/imageParseSdk';
import type { ImageParseSource } from '@/api/map/imageParseSource';
import { parseImagePipeline, type ImageParsePipelineTask } from '@/api/map/imageParsePipeline';

import type { Attachment } from '../types';
import { isPdfAttachment } from '../utils/documentUpload';
import { imageParseKieFieldsError } from '../utils/imageParseKie';
import type { ImageParseLayoutBlock, ImageParseRotationInfo } from '../utils/imageParseSample';
import { imageParseErrorKey } from '../utils/imageParseRequest';
import { ensureImageParseFileReference } from '../utils/imageParseFileReference';
import type { useImageParseCrops } from './useImageParseCrops';
import type { usePdfImageParse } from './usePdfImageParse';

interface ImageParseExecutionContext {
  activeRef: MutableRefObject<AbortController | null>;
  generationRef: MutableRefObject<number>;
  pendingAutoRef: MutableRefObject<boolean>;
  setImage: (attachment?: Attachment) => void;
  setAttachmentReference: (reference: { fileId?: string; publicUrl?: string }) => void;
  cancel: () => void;
}

interface ImageParseExecutionSetters {
  setFields: Dispatch<SetStateAction<string[]>>;
  setMarkdown: Dispatch<SetStateAction<string>>;
  setLayout: Dispatch<SetStateAction<readonly ImageParseLayoutBlock[]>>;
  setSource: Dispatch<SetStateAction<ImageParseSource | undefined>>;
  setRotation: Dispatch<SetStateAction<ImageParseRotationInfo | undefined>>;
  setError: Dispatch<SetStateAction<string | undefined>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setFinished: Dispatch<SetStateAction<boolean>>;
  setResultRevision: Dispatch<SetStateAction<number>>;
}

interface ImageParseExecutionOptions {
  context: ImageParseExecutionContext;
  setters: ImageParseExecutionSetters;
  attachment?: Attachment;
  mode: ImageParseMode;
  fields: readonly string[];
  upright: boolean;
  recognizeSeal: boolean;
  recognizeChart: boolean;
  modelId?: string;
  projectId: string;
  sharedExample: boolean;
  pdfActive: boolean;
  blocked?: string;
  pdf: ReturnType<typeof usePdfImageParse>;
  clearCrops: () => void;
  loadCrops: ReturnType<typeof useImageParseCrops>['loadCrops'];
}

/**
 * 执行单张图片或 PDF 的识别请求，并隔离取消、超时和过期响应。
 * 所有任务只调用 MAP 同源算法代理，识别前必须取得文件服务 fileId。
 * @param options 当前附件、档位、凭据、状态写入器与裁图编排
 * @returns parse 与 stop 入口；并发请求由 generation 和 AbortSignal 淘汰
 */
export function useImageParseExecution(options: ImageParseExecutionOptions) {
  const queryClient = useContext(QueryClientContext);
  const { t } = useTranslation('playground');
  const {
    context,
    setters,
    attachment,
    mode,
    fields,
    upright,
    modelId,
    projectId,
    sharedExample,
    pdfActive,
    blocked,
    pdf,
    clearCrops,
    loadCrops,
  } = options;
  const { activeRef, generationRef, pendingAutoRef, setImage, setAttachmentReference, cancel } =
    context;
  const { setError, setLoading } = setters;

  async function parse(options?: { fields: readonly string[] }) {
    if (sharedExample) return;
    pendingAutoRef.current = false;
    const requestFields = [...(options?.fields ?? fields)];
    const pipelineTask: ImageParsePipelineTask =
      mode === 'seal' || mode === 'kie' ? mode : 'standard';
    const imageOnly = pipelineTask !== 'standard';
    if (mode === 'seal') {
      if (attachment && isPdfAttachment(attachment)) {
        setters.setError(t('imageParsePipelinePdfUnsupported'));
        return;
      }
    }
    if (mode === 'kie') {
      const fieldError = imageParseKieFieldsError(requestFields);
      if (fieldError) {
        setters.setError(t(fieldError));
        return;
      }
    }
    if (blocked) {
      setters.setError(t(blocked));
      return;
    }
    if (!attachment) return;
    if (mode === 'kie') setters.setFields(requestFields);
    if (pdfActive) {
      setters.setError(undefined);
      return void pdf.parse();
    }
    setImage(attachment);
    pendingAutoRef.current = false;
    const controller = new AbortController();
    activeRef.current = controller;
    const run = generationRef.current;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(300_000)]);
    const isCurrent = () => generationRef.current === run && !controller.signal.aborted;
    const execute = (fileId: string) => {
      return parseImagePipeline({
        mode: pipelineTask,
        model: modelId ?? '',
        fields: requestFields,
        pageIndex: 0,
        upright: mode === 'seal' ? false : upright,
        recognizeSeal: true,
        recognizeChart: true,
        signal,
        fileId,
        ...(queryClient ? { queryClient } : {}),
      });
    };
    setters.setLoading(true);
    setters.setResultRevision((value) => value + 1);
    try {
      const reference = await ensureImageParseFileReference({ attachment, projectId, signal });
      if (!isCurrent()) return;
      setAttachmentReference({ fileId: reference.fileId });
      const result: ImageParseSdkResult = await execute(reference.fileId);
      if (result && isCurrent()) {
        setters.setMarkdown(result.markdown);
        setters.setLayout(result.blocks);
        setters.setSource(undefined);
        setters.setRotation(result.rotation);
        setters.setFinished(true);
        if (imageOnly) clearCrops();
        else void loadCrops(result, attachment.dataUrl, controller.signal, isCurrent);
      }
    } catch (failure) {
      if (!isCurrent()) return;
      if (failure instanceof DOMException && failure.name === 'AbortError') {
        setters.setError(t('imageParseStopped'));
      } else {
        const key = imageParseErrorKey(failure);
        if (key === 'imageParseModerated') setters.setMarkdown('');
        setters.setError(t(key));
      }
    } finally {
      if (isCurrent()) {
        activeRef.current = null;
        setters.setLoading(false);
      }
    }
  }

  const stop = useCallback(() => {
    if (pdfActive) {
      pdf.stop();
      return;
    }
    const running = Boolean(activeRef.current);
    cancel();
    setLoading(false);
    if (running) setError(t('imageParseStopped'));
  }, [activeRef, cancel, pdf, pdfActive, setError, setLoading, t]);

  return { parse, stop };
}
