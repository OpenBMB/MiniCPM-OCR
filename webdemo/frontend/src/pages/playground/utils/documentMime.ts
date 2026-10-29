/** When the browser did not label a MIME type, normalize by extension; content validity is still checked by upload and the backend. */
const EXTENSION_MIME: ReadonlyArray<readonly [RegExp, string]> = [
  [/\.pdf$/i, 'application/pdf'],
  [/\.webp$/i, 'image/webp'],
  [/\.png$/i, 'image/png'],
  [/\.jpe?g$/i, 'image/jpeg'],
  [/\.jfif$/i, 'image/jpeg'],
  [/\.gif$/i, 'image/gif'],
  [/\.avif$/i, 'image/avif'],
  [/\.heic$/i, 'image/heic'],
  [/\.heif$/i, 'image/heif'],
  [/\.ico$/i, 'image/x-icon'],
  [/\.apng$/i, 'image/apng'],
  [/\.jxl$/i, 'image/jxl'],
  [/\.bmp$/i, 'image/bmp'],
  [/\.tiff?$/i, 'image/tiff'],
];

/** A labeled type stays as-is; an empty type and octet-stream are filled in from the file name. */
export function resolveDocumentMime(file: File): string {
  if (file.type && file.type !== 'application/octet-stream') return file.type;
  return EXTENSION_MIME.find(([pattern]) => pattern.test(file.name))?.[1] ?? '';
}

export function withResolvedDocumentMime(file: File): File {
  const mime = resolveDocumentMime(file);
  if (!mime || mime === file.type) return file;
  return new File([file], file.name, {
    type: mime,
    lastModified: file.lastModified,
  });
}
