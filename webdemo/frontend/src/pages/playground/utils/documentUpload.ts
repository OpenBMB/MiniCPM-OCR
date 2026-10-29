/** 图像解析演示的本地文件读取规则与类型归一化。 */
import type { ImageParseMode } from '@/api/map/imageParseSdk';

import type { Attachment } from '../types';
import { resolveDocumentMime, withResolvedDocumentMime } from './documentMime';

/** OCR 原件上传上限；PDF 使用 Blob URL 本地预览，不转为 base64。 */
export const DOCUMENT_MAX_BYTES = 64 * 1024 * 1024;
/** PDF 逐页识别的最大页数；本地预览、云端历史与服务端校验共用。 */
export const MAX_PDF_PAGES = 500;
/** OCR 工作台接受浏览器可解码的图片类型；SVG 不作为位图输入。 */
export const DOCUMENT_IMAGE_TYPES: readonly string[] = [
  'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/bmp', 'image/webp',
];
/** 文件选择器与拖放共用的格式边界。 */
export const DOCUMENT_ACCEPT = `application/pdf,.pdf,${DOCUMENT_IMAGE_TYPES.join(',')}`;
/** 算法流水线可解码的单图格式；TIFF 在上游固定返回 400。 */
export const PIPELINE_IMAGE_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/bmp',
  'image/webp',
];

/** 上传入口共用的文件边界；算法流水线与历史兼容档位分别传入。 */
export interface DocumentFileRules {
  maxBytes?: number;
  accept?: readonly string[];
  /** 只接收图片；独立印章使用。 */
  imagesOnly?: boolean;
  /** 一次只能选择一个文件；整图任务使用。 */
  singleImage?: boolean;
}

/** 工作台上传面的展示与校验规则；历史兼容档位不额外限制。 */
export interface ImageParseUploadRules extends DocumentFileRules {
  accept: readonly string[];
  imagesOnly: boolean;
  hintKey: string;
}

function mimeAllowed(mime: string, allowed: readonly string[]): boolean {
  const normalized = mime.toLowerCase();
  return allowed.some((item) => {
    const candidate = item.toLowerCase();
    return candidate.endsWith('/*')
      ? normalized.startsWith(candidate.slice(0, -1))
      : normalized === candidate;
  });
}

/** 判断 MIME 是否可作为 OCR 位图输入。 */
export function isDocumentImageMime(mime: string): boolean {
  const normalized = mime.trim().toLowerCase();
  return (
    normalized.startsWith('image/') &&
    normalized.length > 'image/'.length &&
    !normalized.startsWith('image/svg')
  );
}

/** 校验 OCR 可直接提交的图片 data URI 前缀；内容合法性由服务端校验。 */
export function isDocumentImageDataURL(value: string): boolean {
  const match = /^data:(image\/[^;,]+);base64,/i.exec(value);
  return Boolean(match && isDocumentImageMime(match[1]));
}

/** 算法流水线支持的单图 data URI；TIFF 等格式在上游会被拒绝。 */
export function isPipelineImageDataURL(value: string): boolean {
  const match = /^data:(image\/[^;,]+);base64,/i.exec(value);
  return Boolean(
    match && PIPELINE_IMAGE_TYPES.some((mime) => mime === match[1].toLowerCase()),
  );
}

/** 算法流水线可接受的图片 MIME；OBS 文件引用不依赖本地 data URI。 */
export function isPipelineImageMime(mime: string): boolean {
  const normalized = mime.trim().toLowerCase();
  return PIPELINE_IMAGE_TYPES.includes(normalized);
}

/** 判断文档是否为 PDF，不把其它 file 类型当作可预览的文档。 */
export function isPdfAttachment(attachment: Attachment): boolean {
  return attachment.kind === 'file' && attachment.mime === 'application/pdf';
}

/** OCR 接受图片及 PDF；预览能力与模型输入能力分别处理。 */
export function isParseDocument(attachment?: Attachment): attachment is Attachment {
  return Boolean(attachment && (attachment.kind === 'image' || isPdfAttachment(attachment)));
}

/** 返回翻译键，所有上传入口按当前任务规则执行同一校验。 */
export function documentFileError(
  file: File,
  rules: DocumentFileRules = {},
): string | undefined {
  if (!file.size) return 'documentEmptyFile';
  if (file.size > (rules.maxBytes ?? DOCUMENT_MAX_BYTES)) return 'documentFileTooLarge';
  const mime = resolveDocumentMime(file);
  if (mime !== 'application/pdf' && !isDocumentImageMime(mime)) return 'imageParseOnlyImage';
  if (mime === 'application/pdf' && rules.imagesOnly) return 'imageParsePipelineImageOnly';
  if (rules.accept && !mimeAllowed(mime, rules.accept)) return 'imageParsePipelineImageType';
  return undefined;
}

/** 文件选择器 accept 属性；PDF 同时带上扩展名，兼容未标 MIME 的浏览器。 */
export function documentAccept(rules?: DocumentFileRules): string {
  if (!rules?.accept) return DOCUMENT_ACCEPT;
  return rules.accept
    .map((mime) => (mime === 'application/pdf' ? 'application/pdf,.pdf' : mime))
    .join(',');
}

/**
 * 按识别档位生成上传规则。标准和 KIE 接受图片及原始 PDF，独立印章仅接受图片。
 */
export function imageParseUploadRules(mode: ImageParseMode): ImageParseUploadRules | undefined {
  const imagesOnly = mode === 'seal';
  return {
    accept: imagesOnly ? PIPELINE_IMAGE_TYPES : ['application/pdf', ...PIPELINE_IMAGE_TYPES],
    imagesOnly,
    singleImage: imagesOnly || mode === 'kie',
    hintKey: imagesOnly
      ? 'imageParseUploadHintPipelineImages'
      : 'imageParseUploadHintPipeline',
  };
}

/** 浏览器未标注 MIME 时按扩展名归一化；内容有效性仍由上传与后端校验。 */
export function normalizeDocumentFile(file: File): File {
  return withResolvedDocumentMime(file);
}
