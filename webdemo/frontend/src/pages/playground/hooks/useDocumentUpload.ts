/** 文档远端上传生命周期：替换即取消旧任务，失败保留文件以便重试。 */
import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ReadAttachmentResult } from '../utils/attachments';
import type { Attachment } from '../types';
import { readPreviewAttachment, type ReadAttachmentOptions } from '../utils/attachments';
import { uploadImageParseDocument } from '../utils/imageParseUpload';
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_IMAGE_TYPES,
  documentFileError,
  normalizeDocumentFile,
  type DocumentFileRules,
} from '../utils/documentUpload';

interface UploadState {
  file?: File;
  pending: boolean;
  error?: string;
}

/** OCR 文档读取配置：本地大小上限必须显式传入，避免通用附件默认值误伤 PDF。 */
interface DocumentReadOptions extends ReadAttachmentOptions {
  maxBytes: number;
}

/**
 * 编排图像解析的真实上传，组件卸载或新文件到来时隔离过期响应。
 * @param onReady 成功后替换当前附件
 * @param scope 账号及默认项目标识，变化时取消旧上传
 * @param onStart 文件通过校验后清除旧识别结果
 * @param previewOnly 无解析模型时仅本地预览，不向服务端上传
 * @param rules 当前识别档位的格式、数量与大小边界
 */
export function useDocumentUpload(
  onReady: (attachment: Attachment) => void,
  scope = '',
  onStart?: () => void,
  previewOnly = false,
  rules?: DocumentFileRules,
) {
  const { t } = useTranslation('playground');
  const [state, setState] = useState<UploadState>({ pending: false });
  const active = useRef<AbortController | null>(null);
  const previousScope = useRef(scope);
  const mutation = useMutation({
    // 上传由用户显式重试，不让缓存保留文档内容。
    gcTime: 0,
    retry: false,
    mutationFn: async ({ resultPromise }: { resultPromise: Promise<ReadAttachmentResult> }) => {
      const result = await resultPromise;
      if (!result.ok || !result.attachment)
        throw new Error(result.error || t('documentUploadFailed'));
      return result.attachment;
    },
  });
  const { reset: resetMutation } = mutation;

  useEffect(
    () => () => {
      active.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (previousScope.current === scope) return;
    previousScope.current = scope;
    active.current?.abort();
    active.current = null;
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) {
        resetMutation();
        setState({ pending: false });
      }
    });
    return () => {
      disposed = true;
      active.current?.abort();
    };
  }, [resetMutation, scope]);

  function cancel() {
    active.current?.abort();
    active.current = null;
    mutation.reset();
    setState({ pending: false });
  }

  async function upload(file: File): Promise<Attachment | undefined> {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const error = documentFileError(file, rules);
    if (error) {
      active.current = null;
      mutation.reset();
      setState({ pending: false, error: t(error) });
      return undefined;
    }
    onStart?.();
    setState({ file, pending: true });
    try {
      // 先建立上传请求再交给 mutation 追踪，保证连续替换时旧请求已能立即响应 abort。
      const normalized = normalizeDocumentFile(file);
      // 上传失败不进入识别；只有预览模式允许不访问文件服务。
      const options = {
        maxBytes: rules?.maxBytes ?? DOCUMENT_MAX_BYTES,
        accept: rules?.accept ?? DOCUMENT_IMAGE_TYPES,
      };
      const resultPromise = previewOnly
        ? readPreviewAttachment(normalized, controller.signal, options)
        : readDocumentAttachment(normalized, options, controller.signal);
      const attachment = await mutation.mutateAsync({ resultPromise });
      if (controller.signal.aborted) return undefined;
      onReady(attachment);
      setState({ pending: false });
      return attachment;
    } catch {
      if (controller.signal.aborted) return undefined;
      setState({
        file,
        pending: false,
        // SDK/上游消息可能带签名 URL，界面只展示稳定文案。
        error: t('documentUploadFailed'),
      });
      return undefined;
    } finally {
      if (active.current === controller) {
        active.current = null;
        mutation.reset();
      }
    }
  }

  return { ...state, upload, cancel, retry: () => state.file && void upload(state.file) };
}

/** OCR 原件上传统一通过文件服务。 */
function readDocumentAttachment(file: File, options: DocumentReadOptions, signal: AbortSignal) {
  return uploadImageParseDocument(file, options, signal);
}
