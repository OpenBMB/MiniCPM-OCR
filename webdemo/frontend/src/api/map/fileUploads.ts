import { linkDemoUpload, rememberDemoUpload } from './demoStore';

interface FileUploadConfig {
  enabled: boolean;
  project_id?: string;
}

/** 免登录演示：默认项目始终可用。 */
export async function fileUploadConfig(): Promise<FileUploadConfig> {
  return { enabled: true, project_id: 'demo-project' };
}

/** 生成本地 fileId，并保留文件对象供演示识别结果生成使用。 */
export async function uploadPlaygroundFile(
  file: File,
  projectId: string,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  if (!projectId.trim()) throw new Error('imageParseFileReferenceUploadFailed');
  return rememberDemoUpload(file);
}

/** 用本地 Object URL 作为短时读取链接。 */
export async function linkPlaygroundFile(
  fileId: string,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  return linkDemoUpload(fileId);
}
