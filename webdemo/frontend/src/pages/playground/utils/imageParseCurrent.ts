const STORAGE_PREFIX = 'map:image-parse:current:';
const EMPTY_VALUE = '';

function storageKey(scope: string): string {
  return `${STORAGE_PREFIX}${scope}`;
}

/**
 * 读取当前文档指针。
 * @param scope 用户与项目组成的隔离范围
 * @returns 文档 ID；null 表示用户主动清空，undefined 表示尚未建立指针
 */
export function readCurrentImageParseId(scope: string): string | null | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const value = window.localStorage.getItem(storageKey(scope));
    if (value === null) return undefined;
    return value === EMPTY_VALUE ? null : value;
  } catch {
    return undefined;
  }
}

/**
 * 更新当前文档指针；只保存 ID，不把文件内容写入 localStorage。
 * @param scope 用户与项目组成的隔离范围
 * @param attachmentId 当前附件 ID，传 null 表示主动清空
 */
export function writeCurrentImageParseId(scope: string, attachmentId: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(scope), attachmentId ?? EMPTY_VALUE);
  } catch {
    // 本地存储被禁用或空间不足时不阻断文档解析。
  }
}
