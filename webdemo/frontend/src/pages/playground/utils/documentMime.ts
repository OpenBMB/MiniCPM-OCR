/** 浏览器未标注 MIME 时按扩展名归一化；内容合法性仍由上传与后端校验。 */
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

/** 已标注的类型保持不变；空类型和 octet-stream 按文件名补全。 */
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
