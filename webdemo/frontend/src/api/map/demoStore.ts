/** Local file metadata for the login-free demo; kept only in the current page session and not uploaded remotely. */
const uploads = new Map<string, File>();

/** A public http page is not a secure context, so crypto.randomUUID throws. Use an id that works on that page instead. */
function demoFileId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    try {
      return `demo-${cryptoApi.randomUUID()}`;
    } catch {
      // A non-secure context throws, and execution falls through to the fallback id below.
    }
  }
  const bytes = new Uint8Array(8);
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') cryptoApi.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return `demo-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function rememberDemoUpload(file: File): string {
  const fileId = demoFileId();
  uploads.set(fileId, file);
  return fileId;
}

export function getDemoUpload(fileId?: string): File | undefined {
  return fileId ? uploads.get(fileId) : undefined;
}

export function linkDemoUpload(fileId: string): string {
  const file = uploads.get(fileId);
  if (!file) throw new Error('imageParseHistoryInvalid');
  return URL.createObjectURL(file);
}
