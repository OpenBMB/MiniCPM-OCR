/** Local file-read rules and type normalization for the image-parsing demo. */
import type { ImageParseMode } from '@/api/map/imageParseSdk';

import type { Attachment } from '../types';
import { resolveDocumentMime, withResolvedDocumentMime } from './documentMime';

/** OCR original upload limit; PDFs use a Blob URL for local preview and are not converted to base64. */
export const DOCUMENT_MAX_BYTES = 64 * 1024 * 1024;
/** Maximum pages for per-page PDF recognition; shared by local preview, cloud history, and server checks. */
export const MAX_PDF_PAGES = 500;
/** The OCR workspace accepts image types the browser can decode; SVG is not a bitmap input. */
export const DOCUMENT_IMAGE_TYPES: readonly string[] = [
  'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/bmp', 'image/webp',
];
/** Format bounds shared by the file picker and drag-and-drop. */
export const DOCUMENT_ACCEPT = `application/pdf,.pdf,${DOCUMENT_IMAGE_TYPES.join(',')}`;
/** Single-image formats the algorithm pipeline can decode; TIFF always returns 400 upstream. */
export const PIPELINE_IMAGE_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/bmp',
  'image/webp',
];

/** File bounds shared by upload entries; the algorithm pipeline and the historical compatibility tier pass their own. */
export interface DocumentFileRules {
  maxBytes?: number;
  accept?: readonly string[];
  /** Accept images only; used by standalone seal. */
  imagesOnly?: boolean;
  /** Only one file may be selected at a time; used by whole-image tasks. */
  singleImage?: boolean;
}

/** Display and validation rules for the workspace upload surface; the historical compatibility tier adds no extra limit. */
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

/** Whether a MIME type can be an OCR bitmap input. */
export function isDocumentImageMime(mime: string): boolean {
  const normalized = mime.trim().toLowerCase();
  return (
    normalized.startsWith('image/') &&
    normalized.length > 'image/'.length &&
    !normalized.startsWith('image/svg')
  );
}

/** Check the data-URI prefix of an image OCR can submit directly; content validity is checked by the server. */
export function isDocumentImageDataURL(value: string): boolean {
  const match = /^data:(image\/[^;,]+);base64,/i.exec(value);
  return Boolean(match && isDocumentImageMime(match[1]));
}

/** Single-image data URI the algorithm pipeline supports; formats such as TIFF are rejected upstream. */
export function isPipelineImageDataURL(value: string): boolean {
  const match = /^data:(image\/[^;,]+);base64,/i.exec(value);
  return Boolean(
    match && PIPELINE_IMAGE_TYPES.some((mime) => mime === match[1].toLowerCase()),
  );
}

/** Image MIME types the algorithm pipeline accepts; an OBS file reference does not depend on a local data URI. */
export function isPipelineImageMime(mime: string): boolean {
  const normalized = mime.trim().toLowerCase();
  return PIPELINE_IMAGE_TYPES.includes(normalized);
}

/** Whether the document is a PDF, and do not treat other file types as a previewable document. */
export function isPdfAttachment(attachment: Attachment): boolean {
  return attachment.kind === 'file' && attachment.mime === 'application/pdf';
}

/** OCR accepts images and PDFs; preview capability and model input capability are handled separately. */
export function isParseDocument(attachment?: Attachment): attachment is Attachment {
  return Boolean(attachment && (attachment.kind === 'image' || isPdfAttachment(attachment)));
}

/** Return a translation key; every upload entry runs the same check against the current task rules. */
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

/** File-picker accept attribute; PDFs also include the extension, for browsers that did not label a MIME type. */
export function documentAccept(rules?: DocumentFileRules): string {
  if (!rules?.accept) return DOCUMENT_ACCEPT;
  return rules.accept
    .map((mime) => (mime === 'application/pdf' ? 'application/pdf,.pdf' : mime))
    .join(',');
}

/**
 * Build upload rules from the recognition tier. Standard and KIE accept images and the original PDF; standalone seal accepts images only.
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

/** When the browser did not label a MIME type, normalize by extension; content validity is still checked by upload and the backend. */
export function normalizeDocumentFile(file: File): File {
  return withResolvedDocumentMime(file);
}
