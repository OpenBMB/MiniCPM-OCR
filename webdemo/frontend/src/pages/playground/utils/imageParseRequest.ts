import {
  IMAGE_PARSE_DEFAULT_MODE,
  validateImageParseSdkResult,
  type ImageParseMode,
  type ImageParseSdkResult,
} from '@/api/map/imageParseSdk';
import { getDemoUpload } from '@/api/map/demoStore';
import { parseImageV2 } from '@/api/map/imageParseV2';

import type { Attachment } from '../types';
import { isDocumentImageDataURL } from './documentUpload';

interface ImageParseRun {
  attachment: Attachment;
  signal: AbortSignal;
  isCurrent: () => boolean;
  mode?: ImageParseMode;
  /** 当前登录用户可见的文档解析模型 ID；空值表示无权限。 */
  model: string;
  /** 当前选中 API Key 的明文密钥；仅内存传递，不落盘。 */
  secret: string;
  /** Playground 单图优先使用 OBS 文件引用；文件服务异常时回退内联图片。 */
  fileId?: string;
  /** 文件服务不可用时，使用平台旧资产入口返回的签名链接。 */
  fileUrl?: string;
}

/** 通过 L2 API Key 链路解析页图；不以 L3 代理配置判定 L2 可用性，也不回退传统模型。 */
export async function runImageParse(args: ImageParseRun): Promise<ImageParseSdkResult | undefined> {
  const signal = AbortSignal.any([args.signal, AbortSignal.timeout(300_000)]);
  const assertCurrent = () => {
    signal.throwIfAborted();
    if (!args.isCurrent()) throw new DOMException('Recognition cancelled', 'AbortError');
  };
  assertCurrent();
  if (!args.model?.trim()) throw new Error('imageParseNoModel');
  // 显式传入的空串表示本次必须使用内联图片，不能回退到 attachment，
  // 否则引用失效后的内联重试会再次带上已清理的 fileId/URL。
  const fileId =
    args.fileId !== undefined ? args.fileId.trim() : (args.attachment.fileId?.trim() ?? '');
  const fileUrl =
    args.fileUrl !== undefined ? args.fileUrl.trim() : (args.attachment.publicUrl?.trim() ?? '');
  if (!fileId && !fileUrl && !isDocumentImageDataURL(args.attachment.dataUrl)) {
    throw new Error('imageParseUploadRequired');
  }
  if ([fileId, fileUrl].filter(Boolean).length > 1) {
    throw new Error('imageParseInvalidRequest');
  }
  let payload: { fileId: string } | { fileUrl: string } | { image: string };
  const demoFile = fileId ? getDemoUpload(fileId) : undefined;
  if (demoFile && demoFile.type !== 'application/pdf') {
    payload = { image: await fileToDataUrl(demoFile) };
  } else if (fileId) {
    payload = { fileId };
  } else if (fileUrl) {
    payload = { fileUrl };
  } else {
    payload = { image: args.attachment.dataUrl };
  }
  const result = await parseImageV2(
    payload,
    args.mode ?? IMAGE_PARSE_DEFAULT_MODE,
    signal,
    0,
    args.model.trim(),
    args.secret,
  );
  assertCurrent();
  return validateImageParseSdkResult(result);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('imageParseUploadRequired'));
    reader.readAsDataURL(file);
  });
}

/** 将解析错误键转换为界面文案键；高精度档位超时使用更具体的提示。 */
export function imageParseCopyKey(key: string, mode: ImageParseMode): string {
  return key === 'imageParseTimeout' && mode === 'high-precision'
    ? 'imageParseHighPrecisionTimeout'
    : key;
}

/** 将 v3 OCR 代理错误转换为稳定文案键，不展示未经净化的上游消息。 */
export function imageParseErrorKey(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'imageParseTimeout';
  if (error instanceof Error && /^imageParse[A-Z]/.test(error.message)) return error.message;
  return 'imageParseRequestFailed';
}
