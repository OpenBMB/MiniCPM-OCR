/** 整页识别的可验证引用；时间为 Unix 秒，仅授权该用户/项目的 OCR 块重算。 */
export interface ImageParseSource {
  requestId: string;
  /** 来源证明绑定的模型列表模型 ID。 */
  model: string;
  pageIndex: number;
  /** 服务端签发时间，Unix 秒。 */
  createdAt: number;
  /** 兼容历史快照保留，不再用于禁用重算。 */
  expiresAt: number;
  token: string;
  inputImageSha256?: string;
}

/** 白名单重建可缓存的来源；历史引用仍可随记录恢复并用于块级重算。 */
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

/** 旧缓存与新解析结果分别提供可恢复的提示；expires_at 仅保留兼容历史快照。 */
export function imageParseSourceUnavailable(source?: ImageParseSource): string | undefined {
  if (!source) return 'imageParseRegenerateSourceMissing';
  return undefined;
}
