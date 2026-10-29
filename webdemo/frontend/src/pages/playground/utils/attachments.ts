/**
 * 多模态附件工具：读文件预览、上传对象存储、类型/大小校验、OpenAI content-part 映射。
 *
 * 用途：Playground 上传图像/视频/文件优先走对象存储 URL，避免 base64 撑大 L2 请求体；
 * 音频因 OpenAI input_audio 契约仍使用裸 base64。
 */

import { mapAssetsApi } from '@/api/map/assets';
import { fileUploadConfig, uploadPlaygroundFile } from '@/api/map/fileUploads';
import type { Attachment, AttachmentKind } from '../types';
import type { ChatContentPart } from '@/api/map/chat';

/** 各模态的校验配置：允许的 MIME、大小上限、中文标签 */
interface KindConfig {
  /** 允许的精确 MIME 列表（file 模态不做白名单，仅按大小与「非媒体」兜底） */
  accept: string[];
  /** 大小上限（字节） */
  maxBytes: number;
  /** 中文标签（错误文案用） */
  label: string;
}

const MB = 1024 * 1024;

/** 图片、音频和视频的单个附件大小上限。 */
const MAX_BYTES_PER_ATTACHMENT = 8 * MB;
/** 文档上传大小上限，需与后端 ASSET_UPLOAD_MAX_BYTES 和 portal Nginx 保持一致。 */
const MAX_BYTES_PER_DOCUMENT = 200 * MB;

/** 模态配置表 */
const KIND_CONFIG: Record<AttachmentKind, KindConfig> = {
  image: {
    accept: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    maxBytes: MAX_BYTES_PER_ATTACHMENT,
    label: '图片',
  },
  video: {
    accept: ['video/mp4', 'video/webm', 'video/quicktime'],
    maxBytes: MAX_BYTES_PER_ATTACHMENT,
    label: '视频',
  },
  audio: {
    accept: [
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/x-wav',
      'audio/webm',
      'audio/ogg',
      'audio/mp4',
    ],
    maxBytes: MAX_BYTES_PER_ATTACHMENT,
    label: '音频',
  },
  file: {
    // 常见文档/文本类型；实际以「非 image/video/audio」兜底为 file
    accept: [
      'application/pdf',
      'text/plain',
      'text/markdown',
      'text/csv',
      'application/json',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    maxBytes: MAX_BYTES_PER_DOCUMENT,
    label: '文件',
  },
};

function mimeAllowed(mime: string, allowed: readonly string[]): boolean {
  const normalized = mime.toLowerCase();
  return allowed.some((item) => {
    const candidate = item.toLowerCase();
    return candidate.endsWith('/*')
      ? normalized.startsWith(candidate.slice(0, -1))
      : normalized === candidate;
  });
}

/**
 * 获取单个附件模态对应的文件选择器 accept 值。
 * @param kind 附件模态
 * @returns MIME 与扩展名列表
 */
export function getAttachmentAccept(kind: AttachmentKind): string[] {
  const cfg = KIND_CONFIG[kind];
  if (kind !== 'file') return cfg.accept;
  return [...cfg.accept, '.pdf', '.txt', '.md', '.csv', '.json', '.doc', '.docx'];
}

/** 单条消息附件总数上限（避免请求体过大） */
export const MAX_ATTACHMENTS = 6;

/**
 * 按 MIME 判定附件模态。image/video/audio 前缀分别归类，其余一律视为 file。
 * @param mime 文件 MIME
 */
export function detectKind(mime: string): AttachmentKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

/** 构造本地附件对象；预览地址可以兼容 data URL 与运行时 Blob URL。 */
export function createLocalAttachment(
  file: File,
  previewUrl: string,
  extra?: Pick<Attachment, 'fileId' | 'url' | 'proxyUrl' | 'publicUrl' | 'objectKey'>,
): Attachment {
  return {
    id: nextId(),
    kind: detectKind(file.type),
    name: file.name,
    mime: file.type,
    size: file.size,
    dataUrl: previewUrl,
    ...extra,
  };
}

/** 读取结果：成功带 attachment，失败带中文错误信息 */
export interface ReadAttachmentResult {
  ok: boolean;
  attachment?: Attachment;
  error?: string;
}

/** 调用方可覆盖读取行为；不传 options 时保持 Playground 附件规则。 */
export interface ReadAttachmentOptions {
  /** 单文件大小上限。 */
  maxBytes?: number;
  /** 调用方专用 MIME 白名单；缺省使用当前模态配置。 */
  accept?: readonly string[];
  /** OCR 专用：文件服务不可用时允许退回本地 dataUrl，避免阻断识别。 */
  allowLocalFallback?: boolean;
  /** OCR 专用：直接使用旧资产上传入口，返回平台签名链接。 */
  preferLegacyUpload?: boolean;
}

let seq = 0;
/** 生成附件唯一 id（前端 key / 移除用，无需 crypto 强度） */
function nextId(): string {
  seq += 1;
  return `att_${Date.now().toString(36)}_${seq.toString(36)}`;
}

/**
 * 读取单个文件为本地预览 data URL，不发送网络请求。
 * @param file 用户选中的文件
 * @param signal 连续选图时中止旧文件读取
 * @returns 成功含 attachment；失败含中文 error
 */
export async function readPreviewAttachment(
  file: File,
  signal?: AbortSignal,
  options?: ReadAttachmentOptions,
): Promise<ReadAttachmentResult> {
  const kind = detectKind(file.type);
  const cfg = KIND_CONFIG[kind];
  const maxBytes = options?.maxBytes ?? cfg.maxBytes;
  // 媒体类做 MIME 白名单校验；file 兜底类不限具体类型（仅封顶大小）
  const allowedTypes = options?.accept ?? cfg.accept;
  if (kind !== 'file' && !mimeAllowed(file.type, allowedTypes)) {
    return Promise.resolve({
      ok: false,
      error: `不支持的${cfg.label}格式：${file.type || '未知'}`,
    });
  }
  if (file.size > maxBytes) {
    return Promise.resolve({
      ok: false,
      error: `${cfg.label}过大（上限 ${Math.round(maxBytes / MB)}MB）`,
    });
  }
  signal?.throwIfAborted();
  return new Promise<ReadAttachmentResult>((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const abort = () => {
      cleanup();
      reader.abort();
      reject(new DOMException('Attachment upload aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    reader.onload = () => {
      cleanup();
      resolve({
        ok: true,
        attachment: {
          id: nextId(),
          kind,
          name: file.name,
          mime: file.type,
          size: file.size,
          dataUrl: String(reader.result),
        },
      });
    };
    reader.onerror = () => {
      cleanup();
      resolve({ ok: false, error: `${cfg.label}读取失败` });
    };
    reader.readAsDataURL(file);
  });
}

function isUploadError(
  error: unknown,
): error is { code: string; details?: { obs_code?: unknown } } {
  return Boolean(
    error &&
      typeof error === 'object' &&
      typeof (error as { code?: unknown }).code === 'string',
  );
}

/** 仅服务或存储故障回退旧入口；业务校验、鉴权和限流错误不能绕过。 */
function canFallbackToLegacyUpload(error: unknown): boolean {
  if (!isUploadError(error)) return false;
  if (
    error.code === 'UNAVAILABLE' ||
    error.code === 'NETWORK' ||
    error.code === 'INTERNAL' ||
    error.code === 'ETAG_UNREADABLE' ||
    error.code === 'STORAGE_REJECTED' ||
    error.code === 'INVALID_RESPONSE'
  ) {
    return true;
  }
  return error.code === 'PERMISSION_DENIED' && typeof error.details?.obs_code === 'string';
}

/**
 * 读取附件并优先写入文件服务；通用附件在文件服务故障时回退旧资产入口。
 * OCR 选择本地兜底时不访问旧入口，避免上传最终不会使用的对象。
 * @param file 用户选中的文件
 * @param signalOrIndex 中止信号；兼容旧调用方传入的序号
 * @param options 大小上限与本地兜底策略
 */
export async function readFileAsAttachment(
  file: File,
  signalOrIndex?: AbortSignal | number,
  options?: ReadAttachmentOptions,
): Promise<ReadAttachmentResult> {
  const signal = typeof signalOrIndex === 'number' ? undefined : signalOrIndex;
  const cfg = KIND_CONFIG[detectKind(file.type)];
  const local = await readPreviewAttachment(file, signal, options);
  if (!local.ok || !local.attachment) return local;
  const localAttachment = local.attachment;
  if (signal?.aborted) {
    throw new DOMException('Attachment upload aborted', 'AbortError');
  }

  const uploadLegacy = async (): Promise<ReadAttachmentResult> => {
    const uploaded = await mapAssetsApi.upload(file, signal);
    return {
      ok: true,
      attachment: {
        ...localAttachment,
        url: uploaded.public_url || uploaded.obs_url || uploaded.url,
        proxyUrl: uploaded.proxy_url || uploaded.url,
        publicUrl: uploaded.public_url,
        objectKey: uploaded.key,
      },
    };
  };
  const failed = (failure: unknown): ReadAttachmentResult => {
    const message = failure instanceof Error ? failure.message : `${cfg.label}上传失败`;
    return { ok: false, error: message || `${cfg.label}上传失败` };
  };
  const rethrowAbort = (failure: unknown) => {
    if (failure instanceof DOMException && failure.name === 'AbortError') throw failure;
  };

  if (options?.preferLegacyUpload) {
    try {
      return await uploadLegacy();
    } catch (failure) {
      rethrowAbort(failure);
      if (options.allowLocalFallback) return local;
      return failed(failure);
    }
  }

  let config: Awaited<ReturnType<typeof fileUploadConfig>>;
  try {
    config = await fileUploadConfig();
    signal?.throwIfAborted();
  } catch (failure) {
    rethrowAbort(failure);
    if (options?.allowLocalFallback) return local;
    try {
      return await uploadLegacy();
    } catch (legacyFailure) {
      rethrowAbort(legacyFailure);
      return failed(legacyFailure);
    }
  }

  if (config.enabled) {
    if (!config.project_id) return failed(new Error('上传项目无效'));
    try {
      const fileId = await uploadPlaygroundFile(file, config.project_id, signal);
      return { ok: true, attachment: { ...localAttachment, fileId } };
    } catch (failure) {
      rethrowAbort(failure);
      if (options?.allowLocalFallback) return local;
      if (!canFallbackToLegacyUpload(failure)) return failed(failure);
    }
  } else if (options?.allowLocalFallback) {
    return local;
  }

  try {
    return await uploadLegacy();
  } catch (failure) {
    rethrowAbort(failure);
    return failed(failure);
  }
}

/** 从 data URL 取出去前缀的裸 base64（input_audio.data 需要裸串） */
function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/** 由音频 MIME 推断 OpenAI input_audio 的 format 字段（mp3/wav/...） */
function audioFormat(mime: string): string {
  if (mime === 'audio/mpeg' || mime === 'audio/mp3') return 'mp3';
  if (mime === 'audio/wav' || mime === 'audio/x-wav') return 'wav';
  const sub = mime.split('/')[1];
  return sub || 'mp3';
}

/**
 * 把附件映射为 OpenAI 兼容的 content-part。
 * - image → image_url；video → video_url（Qwen-VL 等约定），优先传平台公开签名代理 URL
 * - audio → input_audio（裸 base64 + format）；file → file（优先 file_url，兜底 file_data）
 * @param att 附件
 */
export function attachmentToPart(att: Attachment): ChatContentPart {
  const url = att.publicUrl || att.url || att.dataUrl;
  switch (att.kind) {
    case 'image':
      return { type: 'image_url', image_url: { url } };
    case 'video':
      return { type: 'video_url', video_url: { url } };
    case 'audio':
      return {
        type: 'input_audio',
        input_audio: { data: stripDataUrlPrefix(att.dataUrl), format: audioFormat(att.mime) },
      };
    case 'file':
      return att.publicUrl || att.url
        ? { type: 'file', file: { filename: att.name, file_url: att.publicUrl || att.url } }
        : { type: 'file', file: { filename: att.name, file_data: att.dataUrl } };
  }
}

/** input[type=file] 的 accept 值：汇总所有模态白名单 + 常见文档扩展名 */
export const ATTACHMENT_ACCEPT = (Object.keys(KIND_CONFIG) as AttachmentKind[])
  .flatMap((kind) => getAttachmentAccept(kind))
  .join(',');

/** 人类可读的文件大小（用于附件展示） */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}
