const STORAGE_PREFIX = 'map:image-parse:current:';
const EMPTY_VALUE = '';

function storageKey(scope: string): string {
  return `${STORAGE_PREFIX}${scope}`;
}

/**
 * Read the current document pointer.
 * @param scope isolation scope made of the user and the project
 * @returns document ID; null means the user cleared it on purpose, undefined means no pointer has been established yet
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
 * Update the current document pointer; save only the ID, and do not write file content into localStorage.
 * @param scope isolation scope made of the user and the project
 * @param attachmentId current attachment ID; null means a clear on purpose
 */
export function writeCurrentImageParseId(scope: string, attachmentId: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(scope), attachmentId ?? EMPTY_VALUE);
  } catch {
    // Do not block document parsing when local storage is disabled or out of space.
  }
}
