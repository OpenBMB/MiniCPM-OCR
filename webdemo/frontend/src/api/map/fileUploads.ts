import { linkDemoUpload, rememberDemoUpload } from './demoStore';

interface FileUploadConfig {
  enabled: boolean;
  project_id?: string;
}

/** Login-free demo: the default project is always available. */
export async function fileUploadConfig(): Promise<FileUploadConfig> {
  return { enabled: true, project_id: 'demo-project' };
}

/** Generate a local fileId and keep the file object for generating demo recognition results. */
export async function uploadPlaygroundFile(
  file: File,
  projectId: string,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  if (!projectId.trim()) throw new Error('imageParseFileReferenceUploadFailed');
  return rememberDemoUpload(file);
}

/** Use a local object URL as a short-lived read link. */
export async function linkPlaygroundFile(
  fileId: string,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  return linkDemoUpload(fileId);
}
