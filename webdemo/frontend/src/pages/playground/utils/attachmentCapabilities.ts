import type { AttachmentKind } from '../types';
import { detectKind, getAttachmentAccept } from './attachments';

const CAPABILITY_BY_KIND: Record<AttachmentKind, string> = {
  image: 'input_image',
  video: 'input_video',
  audio: 'input_audio',
  file: 'input_file',
};

/**
 * 返回模型明确支持的附件模态。
 * @param capabilities 当前模型的能力配置
 * @returns 可上传的附件模态
 */
export function supportedAttachmentKinds(
  capabilities: Record<string, boolean> | undefined,
): AttachmentKind[] {
  if (!capabilities) return [];
  return (Object.keys(CAPABILITY_BY_KIND) as AttachmentKind[]).filter(
    (kind) => capabilities[CAPABILITY_BY_KIND[kind]] === true,
  );
}

/**
 * 判断模型是否支持指定附件模态。
 * @param capabilities 当前模型的能力配置
 * @param kind 待校验的附件模态
 * @returns 是否支持
 */
export function supportsAttachmentKind(
  capabilities: Record<string, boolean> | undefined,
  kind: AttachmentKind,
): boolean {
  return capabilities?.[CAPABILITY_BY_KIND[kind]] === true;
}

/**
 * 按模型能力生成文件选择器 accept 值，避免给不支持的模态展示上传选项。
 * @param capabilities 当前模型的能力配置
 * @returns 文件选择器 accept 值
 */
export function attachmentAcceptForCapabilities(
  capabilities: Record<string, boolean> | undefined,
): string {
  return supportedAttachmentKinds(capabilities)
    .flatMap((kind) => getAttachmentAccept(kind))
    .join(',');
}

/**
 * 生成附件不支持时的中文提示。
 * @param kind 文件识别出的附件模态
 * @returns 用户可读错误信息
 */
export function unsupportedAttachmentMessage(kind: AttachmentKind): string {
  const labels: Record<AttachmentKind, string> = {
    image: '图片',
    video: '视频',
    audio: '音频',
    file: '文件',
  };
  return `当前模型不支持${labels[kind]}输入`;
}

/**
 * 根据文件 MIME 和模型能力校验附件是否可上传。
 * @param capabilities 当前模型的能力配置
 * @param mime 文件 MIME
 * @returns 通过时返回 undefined，否则返回错误信息
 */
export function validateAttachmentCapability(
  capabilities: Record<string, boolean> | undefined,
  mime: string,
): string | undefined {
  const kind = detectKind(mime);
  return supportsAttachmentKind(capabilities, kind)
    ? undefined
    : unsupportedAttachmentMessage(kind);
}
