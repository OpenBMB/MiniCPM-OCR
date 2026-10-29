/** Verifiable reference for a full-page recognition; times are Unix seconds, and it authorizes OCR block recompute only for that user/project. */
export interface ImageParseSource {
  requestId: string;
  /** Model-list model ID bound to the source proof. */
  model: string;
  pageIndex: number;
  /** Server issue time, Unix seconds. */
  createdAt: number;
  /** Kept for historical snapshot compatibility, and no longer used to disable recompute. */
  expiresAt: number;
  token: string;
  inputImageSha256?: string;
}

/** Rebuild a cacheable source from the allowlist; historical references can still be restored with the record and used for block-level recompute. */
export function sanitizeImageParseSource(value: unknown): ImageParseSource | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Record<string, unknown>;
  if (
    typeof item.requestId !== 'string' ||
    !/^[a-f\d]{32}$/.test(item.requestId) ||
    typeof item.model !== 'string' ||
    !item.model.trim() ||
    item.model.length > 256 ||
    !Number.isSafeInteger(item.pageIndex) ||
    (item.pageIndex as number) < 0 ||
    (item.pageIndex as number) > 999 ||
    !Number.isSafeInteger(item.createdAt) ||
    (item.createdAt as number) <= 0 ||
    !Number.isSafeInteger(item.expiresAt) ||
    (item.expiresAt as number) <= (item.createdAt as number) ||
    (item.expiresAt as number) - (item.createdAt as number) > 86_400 ||
    typeof item.token !== 'string' ||
    !item.token ||
    item.token.length > 65_536
  )
    return undefined;
  const source: ImageParseSource = {
    requestId: item.requestId,
    model: item.model,
    pageIndex: item.pageIndex as number,
    createdAt: item.createdAt as number,
    expiresAt: item.expiresAt as number,
    token: item.token,
  };
  if (typeof item.inputImageSha256 === 'string' && /^[a-f\d]{64}$/.test(item.inputImageSha256))
    source.inputImageSha256 = item.inputImageSha256;
  return source;
}

/** Old cache and new parse results each provide a recoverable hint; expires_at is kept only for historical snapshot compatibility. */
export function imageParseSourceUnavailable(source?: ImageParseSource): string | undefined {
  if (!source) return 'imageParseRegenerateSourceMissing';
  return undefined;
}
