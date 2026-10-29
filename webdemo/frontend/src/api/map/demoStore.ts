/** 免登录演示的本地文件元数据；只在当前页面会话内保存，不上传远端。 */
const uploads = new Map<string, File>();

/** 公网 http 页面不是安全上下文，crypto.randomUUID 会抛错，改用可在该页面使用的编号。 */
function demoFileId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    try {
      return `demo-${cryptoApi.randomUUID()}`;
    } catch {
      // 非安全上下文会抛错，落到下面的备用编号。
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
