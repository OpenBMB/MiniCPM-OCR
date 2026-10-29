/**
 * Compose several images into one PDF, reusing the existing paged preview and per-page recognition.
 * A single image and a single PDF stay as the original file.
 */
import {
  documentFileError,
  DOCUMENT_MAX_BYTES,
  MAX_PDF_PAGES,
  normalizeDocumentFile,
  type DocumentFileRules,
} from './documentUpload';
import { withResolvedDocumentMime } from './documentMime';

/** Long-edge cap for a composed page, so a phone original does not overwhelm the main thread and later recognition. */
export const IMAGE_GROUP_MAX_EDGE = 2000;

export type PreparedDocument = { ok: true; file: File } | { ok: false; error: string };

interface JpegPage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/** Preview renders at 2x and page size uses half the pixels, so the recognition image can return to the original image pixels. */
export function pdfFromJpegs(pages: readonly JpegPage[]): Uint8Array {
  if (!pages.length) throw new Error('documentEmptyFile');
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  let position = 0;
  const offsets = [0];
  const add = (chunk: Uint8Array) => {
    parts.push(chunk);
    position += chunk.length;
  };
  const text = (value: string) => add(encoder.encode(value));
  const begin = (id: number) => {
    offsets[id] = position;
    text(`${id} 0 obj\n`);
  };
  const points = (pixels: number) => {
    const value = pixels / 2;
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  };

  text('%PDF-1.4\n');
  const count = pages.length;
  const pageId = (index: number) => 3 + index * 3;
  const imageId = (index: number) => 4 + index * 3;
  const contentId = (index: number) => 5 + index * 3;
  const kids = pages.map((_, index) => `${pageId(index)} 0 R`).join(' ');

  begin(1);
  text('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  begin(2);
  text(`<< /Type /Pages /Count ${count} /Kids [${kids}] >>\nendobj\n`);

  pages.forEach((page, index) => {
    const width = points(page.width);
    const height = points(page.height);
    begin(pageId(index));
    text(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 ${imageId(index)} 0 R >> >> /Contents ${contentId(index)} 0 R >>\nendobj\n`,
    );
    begin(imageId(index));
    text(
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`,
    );
    add(page.bytes);
    text('endstream\nendobj\n');
    const content = encoder.encode(`q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ\n`);
    begin(contentId(index));
    text(`<< /Length ${content.length} >>\nstream\n`);
    add(content);
    text('endstream\nendobj\n');
  });

  const xref = position;
  text(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (let id = 1; id < offsets.length; id += 1) {
    text(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  }
  text(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const output = new Uint8Array(position);
  let cursor = 0;
  parts.forEach((part) => {
    output.set(part, cursor);
    cursor += part.length;
  });
  return output;
}

function groupFileName(files: readonly File[]): string {
  const stem = files[0]?.name.replace(/\.[^.]+$/, '') || '图片';
  return `${stem} 等${files.length}张.pdf`;
}

/** Turn one image into a JPEG page. An existing page passes Infinity, so shrinking it does not misalign the original recognition boxes. */
export async function imageFileToJpegPage(
  file: File,
  maxEdge = IMAGE_GROUP_MAX_EDGE,
): Promise<JpegPage> {
  const bitmap = await createImageBitmap(file);
  try {
    const edge = Math.max(bitmap.width, bitmap.height);
    const scale = edge > maxEdge ? maxEdge / edge : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('documentUploadFailed');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.92);
    });
    if (!blob) throw new Error('documentUploadFailed');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
  } finally {
    bitmap.close();
  }
}

async function imagesToPdfFile(files: readonly File[]): Promise<File> {
  const pages: JpegPage[] = [];
  for (const file of files) pages.push(await imageFileToJpegPage(file));
  const bytes = pdfFromJpegs(pages);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new File([buffer], groupFileName(files), { type: 'application/pdf' });
}

/**
 * One PDF stays as-is. Several images are composed into one PDF. Several PDFs, or a PDF mixed with images, return an error key.
 * A single-file result is synchronous, so the existing selection flow does not wait an extra round.
 */
export function prepareDocumentFiles(
  incoming: FileList | readonly File[],
  rules: DocumentFileRules = {},
): PreparedDocument | Promise<PreparedDocument> {
  const files = Array.from(incoming, (file) =>
    normalizeDocumentFile(withResolvedDocumentMime(file)),
  );
  if (!files.length) return { ok: false, error: 'documentEmptyFile' };
  if (rules.singleImage && files.length > 1) {
    return { ok: false, error: 'imageParsePipelineOneImage' };
  }
  if (files.length > 1 && files.some((file) => file.type === 'application/pdf')) {
    return { ok: false, error: 'documentOnePdf' };
  }
  for (const file of files) {
    const error = documentFileError(file, rules);
    if (error) return { ok: false, error };
  }
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > (rules.maxBytes ?? DOCUMENT_MAX_BYTES)) {
    return { ok: false, error: 'documentFileTooLarge' };
  }
  if (files.length === 1) return { ok: true, file: files[0] };
  if (files.length > MAX_PDF_PAGES) return { ok: false, error: 'imageParsePdfTooManyPages' };
  return imagesToPdfFile(files).then(
    (file) => {
      if (file.size > (rules.maxBytes ?? DOCUMENT_MAX_BYTES)) {
        return { ok: false, error: 'documentFileTooLarge' };
      }
      return { ok: true, file };
    },
    () => ({ ok: false, error: 'documentUploadFailed' }),
  );
}

/** A synchronous result calls back immediately; only several images wait for composition to finish. */
export function applyPreparedDocument(
  incoming: FileList | readonly File[] | null | undefined,
  onFile: (file: File) => void,
  onError: (errorKey: string) => void,
  rules: DocumentFileRules = {},
): void {
  if (!incoming?.length) return;
  const prepared = prepareDocumentFiles(incoming, rules);
  const apply = (result: PreparedDocument) => {
    if (result.ok) onFile(result.file);
    else onError(result.error);
  };
  if (prepared instanceof Promise) void prepared.then(apply);
  else apply(prepared);
}
