import type { AttachmentKind } from '../types';
import { detectKind, getAttachmentAccept } from './attachments';

const CAPABILITY_BY_KIND: Record<AttachmentKind, string> = {
  image: 'input_image',
  video: 'input_video',
  audio: 'input_audio',
  file: 'input_file',
};

/**
 * Return the attachment modalities the model explicitly supports.
 * @param capabilities capability config of the current model
 * @returns attachment modalities that can be uploaded
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
 * Whether the model supports the given attachment modality.
 * @param capabilities capability config of the current model
 * @param kind attachment modality to check
 * @returns whether it is supported
 */
export function supportsAttachmentKind(
  capabilities: Record<string, boolean> | undefined,
  kind: AttachmentKind,
): boolean {
  return capabilities?.[CAPABILITY_BY_KIND[kind]] === true;
}

/**
 * Build the file-picker accept value from model capabilities, so upload options are not shown for unsupported modalities.
 * @param capabilities capability config of the current model
 * @returns file-picker accept value
 */
export function attachmentAcceptForCapabilities(
  capabilities: Record<string, boolean> | undefined,
): string {
  return supportedAttachmentKinds(capabilities)
    .flatMap((kind) => getAttachmentAccept(kind))
    .join(',');
}

/**
 * Build the Chinese message shown when an attachment is unsupported.
 * @param kind attachment modality recognized from the file
 * @returns user-readable error message
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
 * Check whether an attachment can be uploaded from the file MIME and the model capabilities.
 * @param capabilities capability config of the current model
 * @param mime file MIME
 * @returns undefined when it passes, otherwise an error message
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
