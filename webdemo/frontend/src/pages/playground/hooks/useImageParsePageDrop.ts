import { useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@map/ui';

import type { DocumentFileRules } from '../utils/documentUpload';
import { applyPreparedDocument } from '../utils/imageGroupPdf';

/**
 * Take over whole-page drag and drop on the empty workspace area, reusing the PDF/image preprocessing that runs before upload.
 * @param onFile entry that handles the single file that has already passed the drop checks
 * @param rules format and count bounds of the current recognition tier
 * @returns drag-highlight state and drop events that can be spread onto the container directly
 */
export function useImageParsePageDrop(
  onFile: (file: File) => void,
  rules?: DocumentFileRules,
) {
  const { t } = useTranslation('playground');
  const { toast } = useToast();
  const [dragging, setDragging] = useState(false);
  return {
    dragging,
    containerProps: {
      onDragOver(event: DragEvent<HTMLDivElement>) {
        if (!Array.from(event.dataTransfer.types).includes('Files')) return;
        event.preventDefault();
        setDragging(true);
      },
      onDragLeave(event: DragEvent<HTMLDivElement>) {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDragging(false);
      },
      onDrop(event: DragEvent<HTMLDivElement>) {
        if (!Array.from(event.dataTransfer.types).includes('Files')) return;
        event.preventDefault();
        setDragging(false);
        applyPreparedDocument(
          event.dataTransfer.files,
          onFile,
          (error) => toast({ title: t(error), variant: 'error' }),
          rules,
        );
      },
    },
  };
}
