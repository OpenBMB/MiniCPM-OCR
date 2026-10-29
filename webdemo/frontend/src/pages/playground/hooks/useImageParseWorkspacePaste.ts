import { useEffect } from 'react';
import type { DocumentFileRules } from '../utils/documentUpload';
import { applyPreparedDocument } from '../utils/imageGroupPdf';

/** An empty workspace still supports pasting a file; inputs and the editor keep their own clipboard behavior. Several images are composed into one document. */
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
