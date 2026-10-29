import { useEffect } from 'react';
import type { DocumentFileRules } from '../utils/documentUpload';
import { applyPreparedDocument } from '../utils/imageGroupPdf';

/** 空工作台仍支持文件粘贴，输入框与编辑器保留自己的剪贴板行为。多张图片会合成一份。 */
export function useImageParseWorkspacePaste(
  enabled: boolean,
  onPick: (file: File) => void,
  rules?: DocumentFileRules,
) {
  useEffect(() => {
    if (!enabled) return;
    const paste = (event: ClipboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('input, textarea, [contenteditable="true"]')
      )
        return;
      const files = event.clipboardData?.files;
      if (!files?.length) return;
      event.preventDefault();
      applyPreparedDocument(files, onPick, () => undefined, rules);
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, [enabled, onPick, rules]);
}
