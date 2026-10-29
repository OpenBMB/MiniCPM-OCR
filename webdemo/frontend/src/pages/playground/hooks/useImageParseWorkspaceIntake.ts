import type { DocumentFileRules } from '../utils/documentUpload';
import { useImageParsePageDrop } from './useImageParsePageDrop';
import { useImageParseWorkspacePaste } from './useImageParseWorkspacePaste';

/**
 * Merge the workspace's page-level drop and paste entries, and use the file bounds of the current recognition tier for both.
 * @param onFile callback for the single file that has already passed checks
 * @param pasteEnabled whether an empty workspace may receive a paste
 * @param rules format, count, and size limits of the current tier
 * @returns page drop-highlight state and container events
 */
export function useImageParseWorkspaceIntake(
  onFile: (file: File) => void,
  pasteEnabled: boolean,
  rules?: DocumentFileRules,
) {
  const pageDrop = useImageParsePageDrop(onFile, rules);
  useImageParseWorkspacePaste(pasteEnabled, onFile, rules);
  return pageDrop;
}
